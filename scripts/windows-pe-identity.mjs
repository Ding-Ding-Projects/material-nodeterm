import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as ResEdit from 'resedit'

export const WINDOWS_PRODUCT_NAME = 'nodeterm'
export const WINDOWS_EXECUTABLE_NAME = 'nodeterm.exe'

function fail(message) {
  throw new Error(message)
}

function parseVersionResources(executableBytes, description) {
  let executable
  try {
    executable = ResEdit.NtExecutable.from(executableBytes, { ignoreCert: true })
  } catch (error) {
    fail(`${description} is not a readable Windows PE: ${error instanceof Error ? error.message : String(error)}`)
  }
  const resources = ResEdit.NtExecutableResource.from(executable)
  const versions = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)
  if (versions.length !== 1) fail(`${description} must contain exactly one version resource`)
  return { executable, resources, version: versions[0] }
}

function requireBuilderIdentity(version, expected, description) {
  const languages = version.getAllLanguagesForStringValues()
  if (languages.length === 0) fail(`${description} version resource has no string values`)
  for (const language of languages) {
    const values = version.getStringValues(language)
    if (values.ProductName !== expected.productName || values.FileDescription !== expected.productName) {
      fail(`${description} must be resource-edited by electron-builder before the afterSign identity hook runs`)
    }
  }
  return languages
}

/**
 * electron-builder intentionally writes an empty OriginalFilename while applying the
 * icon and product metadata. Set the exact branded filename after that edit and before
 * Squirrel copies the app resources into the ExecutionStub and full package.
 */
export async function patchWindowsAppIdentity(executableFile, expected = {}) {
  const productName = expected.productName ?? WINDOWS_PRODUCT_NAME
  const originalFilename = expected.originalFilename ?? WINDOWS_EXECUTABLE_NAME
  const internalName = expected.internalName ?? path.parse(originalFilename).name
  const description = expected.description ?? path.basename(executableFile)
  const original = await readFile(executableFile)
  const { executable, resources, version } = parseVersionResources(original, description)
  const languages = requireBuilderIdentity(version, { productName }, description)
  for (const language of languages) {
    version.setStringValues(language, { InternalName: internalName, OriginalFilename: originalFilename })
  }
  version.outputToResourceEntries(resources.entries)
  resources.outputResource(executable)
  const generated = Buffer.from(executable.generate())

  const checked = parseVersionResources(generated, description).version
  for (const language of checked.getAllLanguagesForStringValues()) {
    const values = checked.getStringValues(language)
    if (values.OriginalFilename !== originalFilename || values.InternalName !== internalName) {
      fail(`${description} did not retain the branded OriginalFilename/InternalName`)
    }
  }
  await writeFile(executableFile, generated)
  return { executableFile, productName, originalFilename, internalName, languages: languages.length }
}

/** electron-builder afterSign hook. Signing stays disabled; this hook only edits PE strings. */
export async function afterSign(context) {
  if (context.electronPlatformName !== 'win32') return
  const actualProductName = context.packager?.appInfo?.productFilename
  if (actualProductName !== WINDOWS_PRODUCT_NAME) {
    fail(`Windows product filename must remain ${WINDOWS_PRODUCT_NAME}; got ${JSON.stringify(actualProductName)}`)
  }
  const executableFile = path.join(context.appOutDir, WINDOWS_EXECUTABLE_NAME)
  await patchWindowsAppIdentity(executableFile)
}

export default afterSign
