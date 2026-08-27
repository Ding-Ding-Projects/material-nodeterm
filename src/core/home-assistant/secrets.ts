import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clearAtomicTarget, renameAtomic, tempNameFor } from '../fs-atomic'
import { platform } from '../platform'
import { isHomeAssistantInstanceId } from '../../shared/home-assistant'

interface SealedToken { version: 1; tokenEnc: string }

function files(id: string): { sealed: string; raw: string } {
  if (!isHomeAssistantInstanceId(id)) throw new Error('Home Assistant instance id is invalid.')
  const root = path.join(platform().userDataDir, 'home-assistant', 'credentials')
  return { sealed: path.join(root, `${id}.json`), raw: path.join(root, `${id}.bin`) }
}

function sealing(): boolean {
  const current = platform()
  const seal = typeof current.sealSecret === 'function'
  const unseal = typeof current.unsealSecret === 'function'
  if (seal !== unseal) throw new Error('CorePlatform must supply both secret sealing operations, or neither.')
  return seal
}

function valid(token: string): boolean {
  return token.trim() === token && token.length > 0 && token.length <= 8192 && !/[\r\n\0]/.test(token)
}

async function writePrivate(file: string, value: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = tempNameFor(file)
  await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 })
  await renameAtomic(temporary, file)
}

/** Write or clear one instance token. Token values are never exposed by an IPC handler. */
export async function setHomeAssistantInstanceToken(id: string, token: string | null): Promise<void> {
  const target = files(id)
  if (token === null) {
    const [sealed, raw] = await Promise.all([clearAtomicTarget(target.sealed), clearAtomicTarget(target.raw)])
    if (!sealed.cleared || !raw.cleared) throw new Error('The Home Assistant access token could not be fully cleared.')
    return
  }
  if (!valid(token)) throw new Error('Home Assistant access token is empty or malformed.')
  if (sealing()) {
    const body: SealedToken = { version: 1, tokenEnc: platform().sealSecret!(Buffer.from(token, 'utf8')).toString('base64') }
    await writePrivate(target.sealed, `${JSON.stringify(body)}\n`)
    if (!(await clearAtomicTarget(target.raw)).cleared) throw new Error('The old Home Assistant credential representation could not be cleared.')
  } else {
    await writePrivate(target.raw, token)
    if (!(await clearAtomicTarget(target.sealed)).cleared) throw new Error('The old Home Assistant credential representation could not be cleared.')
  }
}

/** Core-only token read used immediately before an authenticated request. */
export async function getHomeAssistantInstanceToken(id: string): Promise<string | null> {
  const target = files(id)
  const useSealed = sealing()
  const preferred = useSealed ? target.sealed : target.raw
  const alternate = useSealed ? target.raw : target.sealed
  let raw: string
  try { raw = await readFile(preferred, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    try { await readFile(alternate) } catch (alternateError) {
      if ((alternateError as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw alternateError
    }
    throw new Error('The stored Home Assistant token is in an unavailable credential format.')
  }
  if (!useSealed) {
    if (!valid(raw)) throw new Error('The stored Home Assistant token is malformed.')
    return raw
  }
  let parsed: SealedToken
  try { parsed = JSON.parse(raw) as SealedToken } catch { throw new Error('The stored Home Assistant token is malformed.') }
  if (parsed.version !== 1 || typeof parsed.tokenEnc !== 'string') throw new Error('The stored Home Assistant token is malformed.')
  const token = platform().unsealSecret!(Buffer.from(parsed.tokenEnc, 'base64')).toString('utf8')
  if (!valid(token)) throw new Error('The stored Home Assistant token is malformed.')
  return token
}
