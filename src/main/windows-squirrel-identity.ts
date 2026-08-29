import packageMetadata from '../../package.json'

export interface WindowsAppUserModelIdTarget {
  setAppUserModelId(appUserModelId: string): void
}

interface WindowsBuildMetadata {
  appId?: string
  executableName?: string
  productName?: string
  squirrelWindows?: {
    name?: string
    useAppIdAsId?: boolean
  }
  win?: {
    executableName?: string
    name?: string
  }
}

export interface WindowsSquirrelPackageMetadata {
  name: string
  productName?: string
  build?: WindowsBuildMetadata
}

export interface WindowsSquirrelIdentity {
  packageId: string
  executableName: string
  appUserModelId: string
}

const INVALID_WINDOWS_FILENAME_CHARACTER = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED_WINDOWS_FILENAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i

function requireNonEmpty(value: string | undefined, description: string): string {
  if (value == null || value.trim() === '') {
    throw new Error(`${description} must be a non-empty string`)
  }
  return value
}

function requireUnsanitizedWindowsExecutableName(value: string): string {
  if (
    INVALID_WINDOWS_FILENAME_CHARACTER.test(value) ||
    RESERVED_WINDOWS_FILENAME.test(value) ||
    value.endsWith('.') ||
    value.endsWith(' ') ||
    Buffer.byteLength(value, 'utf8') > 255
  ) {
    throw new Error(
      'The Windows executable name must already be a valid filename so Electron Builder and the runtime AppUserModelID cannot disagree'
    )
  }
  return value
}

/**
 * Derive the identity that Squirrel writes into its shortcuts.
 *
 * Electron Builder passes the npm package name to Squirrel by default and passes the sanitized
 * product filename as the executable. That package name is also the update identity stored in
 * existing `.nupkg` files, so changing to `useAppIdAsId` would strand installed versions.
 * Requiring an already-safe filename prevents a future metadata edit from being silently
 * sanitized into a different runtime ID.
 */
export function deriveWindowsSquirrelIdentity(
  metadata: WindowsSquirrelPackageMetadata
): WindowsSquirrelIdentity {
  const build = metadata.build
  if (build?.squirrelWindows?.useAppIdAsId === true) {
    throw new Error(
      'build.squirrelWindows.useAppIdAsId must remain disabled to preserve the existing Squirrel package identity'
    )
  }

  // Squirrel options override Windows options in electron-builder's target merge.
  const packageId = requireNonEmpty(
    build?.squirrelWindows?.name ?? build?.win?.name ?? metadata.name,
    'Squirrel package id'
  )
  const executableName = requireUnsanitizedWindowsExecutableName(
    requireNonEmpty(
      build?.win?.executableName ??
        build?.executableName ??
        build?.productName ??
        metadata.productName ??
        metadata.name,
      'Windows executable name'
    )
  )

  return {
    packageId,
    executableName,
    appUserModelId: squirrelAppUserModelId(packageId, executableName)
  }
}

export function squirrelAppUserModelId(packageId: string, executableName: string): string {
  const normalizedPackageId = requireNonEmpty(packageId, 'Squirrel package id').replace(/\s/g, '')
  const normalizedExecutableName = requireNonEmpty(executableName, 'Windows executable name')
    .replace(/\.exe$/i, '')
    .replace(/\s/g, '')

  if (normalizedPackageId === '' || normalizedExecutableName === '') {
    throw new Error('Squirrel AppUserModelID components must contain a non-whitespace character')
  }

  return `com.squirrel.${normalizedPackageId}.${normalizedExecutableName}`
}

export const WINDOWS_SQUIRREL_IDENTITY = deriveWindowsSquirrelIdentity(
  packageMetadata as WindowsSquirrelPackageMetadata
)

export function applyWindowsSquirrelAppUserModelId(
  platform: NodeJS.Platform,
  target: WindowsAppUserModelIdTarget
): string | null {
  if (platform !== 'win32') return null

  target.setAppUserModelId(WINDOWS_SQUIRREL_IDENTITY.appUserModelId)
  return WINDOWS_SQUIRREL_IDENTITY.appUserModelId
}
