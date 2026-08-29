import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const PUBLIC_ROOTS = ['README.md', 'docs', 'site']
const PUBLIC_EXTENSIONS = new Set(['.html', '.js', '.json', '.md', '.txt'])

const unsafeWildcardPublish =
  /(?:^|\s)(?:-p|--publish)(?:=|\s+)(?:0\.0\.0\.0:)?8443:8443(?=$|\s|\\)/m
const unsafePasswordArgument =
  /(?:^|\s)(?:-e|--env)(?:=|\s+)NODETERM_SERVER_PASSWORD(?:=|(?=$|\s|\\))/m

function unsafeQuickstartReason(source: string): string | undefined {
  if (unsafeWildcardPublish.test(source)) return 'publishes plaintext on every interface'
  if (unsafePasswordArgument.test(source)) return 'puts the server password in process arguments'
  return undefined
}

function publicFiles(root: string): string[] {
  const stat = fs.statSync(root)
  if (stat.isFile()) return [root]
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(root, entry.name)
    if (entry.isDirectory()) return publicFiles(child)
    return PUBLIC_EXTENSIONS.has(path.extname(entry.name)) ? [child] : []
  })
}

describe('public Docker quickstarts', () => {
  it('distinguishes unsafe argument forms from the loopback env-file recipe', () => {
    expect(unsafeQuickstartReason('docker run -p 8443:8443 image')).toMatch(/every interface/)
    expect(
      unsafeQuickstartReason('docker run -e NODETERM_SERVER_PASSWORD=visible image')
    ).toMatch(/process arguments/)
    expect(
      unsafeQuickstartReason(
        'docker run --env-file .env -p 127.0.0.1:8443:8443 -v nodeterm-data:/data image'
      )
    ).toBeUndefined()
  })

  it('never recommends wildcard plaintext publishing or an argv password', () => {
    const violations = PUBLIC_ROOTS.flatMap((root) =>
      publicFiles(root).flatMap((file) => {
        const reason = unsafeQuickstartReason(fs.readFileSync(file, 'utf8'))
        return reason ? [`${path.relative(process.cwd(), file)}: ${reason}`] : []
      })
    )
    expect(violations).toEqual([])
  })
})
