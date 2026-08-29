export interface WindowsPeIdentityPatch {
  productName?: string
  originalFilename?: string
  internalName?: string
  description?: string
}

export function patchWindowsAppIdentity(
  executableFile: string,
  expected?: WindowsPeIdentityPatch,
): Promise<{
  executableFile: string
  productName: string
  originalFilename: string
  internalName: string
  languages: number
}>

export function afterSign(context: {
  electronPlatformName: string
  appOutDir: string
  packager?: { appInfo?: { productFilename?: string } }
}): Promise<void>

export default afterSign
