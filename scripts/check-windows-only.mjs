import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceExtensions = Object.freeze([
  '.bat',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.mts',
  '.md',
  '.ps1',
  '.py',
  '.scss',
  '.sh',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.yml',
  '.yaml',
])

const rootConfigurationFiles = Object.freeze([
  'bootstrap-windows.bat',
  'build-installer.bat',
  'build.bat',
  'build.sh',
  'AGENTS.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'CONTRIBUTING.md',
  '.dockerignore',
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  '.nvmrc',
  'dependencies.manifest.json',
  'docker-compose.yml',
  'Dockerfile',
  'download-dependencies.bat',
  'download-dependencies.sh',
  'electron.vite.config.ts',
  'HANDOFF.md',
  'host.bat',
  'host.sh',
  'LICENSE',
  'package.json',
  'package-lock.json',
  'README.md',
  'ROADMAP.md',
  'THIRD-PARTY-NOTICES.md',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.web.json',
  'vitest.config.ts',
])

// This is deliberately explicit. Generated dependency lock data is excluded because it is
// machine-generated metadata, not authored support logic. Binary evidence is excluded because
// this scanner checks text, while SVG remains included as source text.
export const EXCLUSIONS = Object.freeze({
  generatedFiles: Object.freeze([
    Object.freeze({ path: 'package-lock.json', reason: 'generated dependency lock data' }),
  ]),
  binaryEvidenceExtensions: Object.freeze([
    '.7z',
    '.gif',
    '.ico',
    '.jpeg',
    '.jpg',
    '.mov',
    '.mp4',
    '.nupkg',
    '.png',
    '.webp',
    '.zip',
  ]),
})

const joinFragments = (...fragments) => fragments.join('')
const forbiddenPackageExtensions = Object.freeze([
  joinFragments('.', 'd', 'mg'),
  joinFragments('.', 'i', 'cns'),
])
const inventoryExtensions = Object.freeze([
  ...sourceExtensions,
  ...EXCLUSIONS.binaryEvidenceExtensions,
  ...forbiddenPackageExtensions,
])

// Keep this inventory hand-written. A discovery-only scan can silently stop covering a renamed
// project root, which is precisely the Windows-only regression this check is meant to catch.
export const INVENTORY = Object.freeze([
  Object.freeze({ root: 'src', extensions: inventoryExtensions }),
  Object.freeze({ root: 'scripts', extensions: inventoryExtensions }),
  Object.freeze({ root: 'test', extensions: inventoryExtensions }),
  Object.freeze({ root: 'docs', extensions: inventoryExtensions }),
  Object.freeze({ root: 'site', extensions: inventoryExtensions }),
  Object.freeze({ root: '.github', extensions: Object.freeze(['.json', '.md', '.yml', '.yaml']) }),
  Object.freeze({ root: '.', files: [...rootConfigurationFiles] }),
])

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
const wholeWord = (...fragments) => new RegExp(`\\b${escapeRegex(joinFragments(...fragments))}\\b`, 'iu')
const bareName = (...fragments) => new RegExp(`(?<!\\.)\\b${escapeRegex(joinFragments(...fragments))}\\b`, 'iu')
const contains = (...fragments) => new RegExp(escapeRegex(joinFragments(...fragments)), 'iu')
const extensionName = (...fragments) => new RegExp(`${escapeRegex(joinFragments('.', ...fragments))}\\b`, 'iu')

const commandModifierGlyph = String.fromCodePoint(0x2318)
const compactCommandAliases = [
  joinFragments('cmd', 'or', 'ctrl'),
  joinFragments('command', 'or', 'control'),
].map(escapeRegex).join('|')
const commandModifierPattern = new RegExp(
  `(?:${escapeRegex(commandModifierGlyph)}|\\b(?:${compactCommandAliases})\\b|\\b(?:${escapeRegex(joinFragments('cmd'))}|${escapeRegex(joinFragments('command'))})\\s*(?:\\+|/\\s*${escapeRegex(joinFragments('ctrl'))}|\\b${escapeRegex(joinFragments('key'))}\\b))`,
  'iu',
)

// The fragments above are intentionally neutral in this file. The scanner must not become a
// false positive merely because its own forbidden-term catalog is visible to the scan.
const forbiddenRules = Object.freeze([
  Object.freeze({
    id: 'desktop-operating-system-name',
    category: 'desktop operating-system support',
    pattern: wholeWord('mac', 'os'),
  }),
  Object.freeze({
    id: 'desktop-operating-system-short-name',
    category: 'desktop operating-system support',
    pattern: wholeWord('mac'),
  }),
  Object.freeze({
    id: 'desktop-operating-system-legacy-short-name',
    category: 'desktop operating-system support',
    pattern: wholeWord('os', 'x'),
  }),
  Object.freeze({
    id: 'desktop-operating-system-legacy-spaced-name',
    category: 'desktop operating-system support',
    pattern: /\bos\s+x\b/iu,
  }),
  Object.freeze({
    id: 'vendor-desktop-name',
    category: 'desktop operating-system support',
    pattern: wholeWord('apple'),
  }),
  Object.freeze({
    id: 'desktop-platform-identifier',
    category: 'legacy platform identifier',
    pattern: contains('dar', 'win'),
  }),
  Object.freeze({
    id: 'desktop-platform-property',
    category: 'legacy platform identifier',
    pattern: contains('meta', 'key'),
  }),
  Object.freeze({
    id: 'disk-image-package-name',
    category: 'platform-specific application packaging',
    pattern: bareName('d', 'mg'),
  }),
  Object.freeze({
    id: 'application-icon-package-name',
    category: 'platform-specific application packaging',
    pattern: bareName('i', 'cns'),
  }),
  Object.freeze({
    id: 'disk-image-package',
    category: 'platform-specific application packaging',
    pattern: extensionName('d', 'mg'),
  }),
  Object.freeze({
    id: 'application-icon-container',
    category: 'platform-specific application packaging',
    pattern: extensionName('i', 'cns'),
  }),
  Object.freeze({
    id: 'installer-package-name',
    category: 'platform-specific application packaging',
    pattern: wholeWord('p', 'kg'),
  }),
  Object.freeze({
    id: 'application-bundle-suffix',
    category: 'platform-specific application packaging',
    pattern: extensionName('a', 'pp'),
  }),
  Object.freeze({
    id: 'platform-packaging-tool',
    category: 'platform-specific application packaging',
    pattern: wholeWord('product', 'build'),
  }),
  Object.freeze({
    id: 'platform-signing-tool',
    category: 'platform-specific application packaging',
    pattern: wholeWord('code', 'sign'),
  }),
  Object.freeze({
    id: 'platform-disk-tool',
    category: 'platform-specific application packaging',
    pattern: wholeWord('hdi', 'util'),
  }),
  Object.freeze({
    id: 'platform-notarization',
    category: 'platform-specific application packaging',
    pattern: wholeWord('notar', 'ization'),
  }),
  Object.freeze({
    id: 'keyboard-command-modifier',
    category: 'keyboard command modifier',
    pattern: commandModifierPattern,
  }),
])

const binaryEvidenceExtensions = new Set(EXCLUSIONS.binaryEvidenceExtensions)
const generatedFilePaths = new Set(EXCLUSIONS.generatedFiles.map((entry) => entry.path))

const normalizeRelativePath = (filePath) => filePath.split(path.sep).join('/')
const relativePath = (rootDir, filePath) => normalizeRelativePath(path.relative(rootDir, filePath))
const hasAllowedExtension = (filePath, extensions) => extensions.includes(path.extname(filePath).toLowerCase())
const compareStrings = (left, right) => (left < right ? -1 : left > right ? 1 : 0)

const sortInventoryEntries = (entries) => entries.sort((left, right) => compareStrings(left.name, right.name))

async function collectDirectoryFiles(rootDir, inventoryEntry, errors) {
  const absoluteRoot = path.resolve(rootDir, inventoryEntry.root)
  let rootStat
  try {
    rootStat = await fs.stat(absoluteRoot)
  } catch (error) {
    errors.push({ path: normalizeRelativePath(inventoryEntry.root), message: `inventoried root is unavailable: ${error.message}` })
    return []
  }
  if (!rootStat.isDirectory()) {
    errors.push({ path: normalizeRelativePath(inventoryEntry.root), message: 'inventoried root is not a directory' })
    return []
  }

  const files = []
  async function visit(directory) {
    let entries
    try {
      entries = sortInventoryEntries(await fs.readdir(directory, { withFileTypes: true }))
    } catch (error) {
      errors.push({ path: relativePath(rootDir, directory), message: `directory is unreadable: ${error.message}` })
      return
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        errors.push({ path: relativePath(rootDir, absolutePath), message: 'symbolic links are not inventoried safely' })
        continue
      }
      if (entry.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (entry.isFile() && hasAllowedExtension(absolutePath, inventoryEntry.extensions)) {
        files.push(absolutePath)
      }
    }
  }

  await visit(absoluteRoot)
  return files
}

async function collectExplicitFiles(rootDir, inventoryEntry, errors) {
  const files = []
  for (const file of inventoryEntry.files) {
    const absolutePath = path.resolve(rootDir, file)
    try {
      const stat = await fs.stat(absolutePath)
      if (!stat.isFile()) {
        errors.push({ path: normalizeRelativePath(file), message: 'inventoried path is not a file' })
      } else {
        files.push(absolutePath)
      }
    } catch (error) {
      errors.push({ path: normalizeRelativePath(file), message: `inventoried file is unavailable: ${error.message}` })
    }
  }
  return files
}

function shouldExclude(filePath, rootDir) {
  const normalized = relativePath(rootDir, filePath)
  if (generatedFilePaths.has(normalized)) {
    return { excluded: true, reason: 'generated dependency lock data' }
  }
  if (binaryEvidenceExtensions.has(path.extname(normalized).toLowerCase())) {
    return { excluded: true, reason: 'binary evidence asset, not text source' }
  }
  return { excluded: false, reason: '' }
}

export async function scanProject(rootDir = process.cwd(), options = {}) {
  const resolvedRoot = path.resolve(rootDir)
  const readFile = options.readFile ?? fs.readFile
  const errors = []
  const files = []

  for (const inventoryEntry of INVENTORY) {
    const discovered = inventoryEntry.files
      ? await collectExplicitFiles(resolvedRoot, inventoryEntry, errors)
      : await collectDirectoryFiles(resolvedRoot, inventoryEntry, errors)
    files.push(...discovered)
  }

  const uniqueFiles = [...new Set(files)].sort((left, right) => compareStrings(relativePath(resolvedRoot, left), relativePath(resolvedRoot, right)))
  const findings = []
  const excluded = []

  for (const filePath of uniqueFiles) {
    const normalized = relativePath(resolvedRoot, filePath)
    if (forbiddenPackageExtensions.includes(path.extname(normalized).toLowerCase())) {
      findings.push({
        category: 'platform-specific application packaging',
        column: 1,
        line: 1,
        path: normalized,
        rule: 'platform-package-file',
      })
      continue
    }
    const exclusion = shouldExclude(filePath, resolvedRoot)
    if (exclusion.excluded) {
      excluded.push({ path: relativePath(resolvedRoot, filePath), reason: exclusion.reason })
      continue
    }

    let contents
    try {
      contents = await readFile(filePath, 'utf8')
    } catch (error) {
      errors.push({ path: relativePath(resolvedRoot, filePath), message: `file is unreadable: ${error.message}` })
      continue
    }

    const lines = String(contents).split(/\r\n|\n|\r/u)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      for (const rule of forbiddenRules) {
        let offset = 0
        while (offset <= line.length) {
          const match = rule.pattern.exec(line.slice(offset))
          if (!match) break
          findings.push({
            category: rule.category,
            column: offset + match.index + 1,
            line: index + 1,
            path: relativePath(resolvedRoot, filePath),
            rule: rule.id,
          })
          offset += match.index + Math.max(1, match[0].length)
        }
      }
    }
  }

  findings.sort((left, right) => (
    compareStrings(left.path, right.path)
    || left.line - right.line
    || left.column - right.column
    || compareStrings(left.rule, right.rule)
  ))
  errors.sort((left, right) => compareStrings(left.path, right.path) || compareStrings(left.message, right.message))
  excluded.sort((left, right) => compareStrings(left.path, right.path))

  return Object.freeze({
    errors: Object.freeze(errors),
    excluded: Object.freeze(excluded),
    filesScanned: uniqueFiles.length - excluded.length,
    findings: Object.freeze(findings),
  })
}

export function formatReport(report) {
  const lines = []
  for (const error of report.errors) {
    lines.push(`ERROR ${error.path}: ${error.message}`)
  }
  for (const finding of report.findings) {
    lines.push(`ERROR ${finding.path}:${finding.line}:${finding.column}: ${finding.category} (${finding.rule})`)
  }
  if (lines.length === 0) {
    lines.push(`Windows-only source scan passed: ${report.filesScanned} text files checked.`)
  } else {
    lines.push(`Windows-only source scan failed: ${report.errors.length} inventory/read error(s), ${report.findings.length} forbidden marker(s).`)
  }
  return lines.join('\n')
}

export async function main(rootDir = process.argv[2] ?? process.cwd()) {
  const report = await scanProject(rootDir)
  process.stdout.write(`${formatReport(report)}\n`)
  return report.errors.length === 0 && report.findings.length === 0 ? 0 : 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
