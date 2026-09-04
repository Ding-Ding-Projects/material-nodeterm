import { access } from 'node:fs/promises'
import path from 'node:path'
import { AWS_CLI_WINDOWS_X64_MANIFEST } from '../../shared/aws'

export interface AwsCliManifest {
  version: string
  platform: 'win32-x64'
  url: string
  sha256: string
  bundledRelativePath: string
}

export function awsCliManifest(): AwsCliManifest {
  return { ...AWS_CLI_WINDOWS_X64_MANIFEST }
}

export function bundledInstallerPath(resourcesPath: string | undefined): string | null {
  if (!resourcesPath) return null
  return path.join(resourcesPath, AWS_CLI_WINDOWS_X64_MANIFEST.bundledRelativePath)
}

export async function isReadableFile(filePath: string | null): Promise<boolean> {
  if (!filePath) return false
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
