import { strict as assert } from 'node:assert'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { INVENTORY, scanProject } from './check-windows-only.mjs'

const joinFragments = (...fragments) => fragments.join('')
const legacyPlatformIdentifier = joinFragments('dar', 'win')
const desktopOperatingSystemName = joinFragments('m', 'ac', 'OS')
const diskImagePackage = joinFragments('.', 'd', 'mg')
const diskImagePackageName = joinFragments('d', 'mg')
const commandModifierGlyph = String.fromCodePoint(0x2318)
const compactCommandModifier = joinFragments('Cmd', 'Or', 'Ctrl')
const longCommandModifier = joinFragments('Command', 'Or', 'Control')

function contentForExtension(extension) {
  if (extension === '.json') return '{}\n'
  if (extension === '.html') return '<!doctype html><title>Clean</title>\n'
  if (extension === '.css' || extension === '.scss') return ':root {}\n'
  if (extension === '.md' || extension === '.txt') return '# Clean\n'
  if (extension === '.yml' || extension === '.yaml') return 'name: clean\n'
  if (extension === '.bat') return '@echo off\r\necho clean\r\n'
  if (extension === '.sh') return '#!/bin/sh\nprintf clean\n'
  return 'export const clean = true\n'
}

async function createFixture() {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'windows-only-source-'))
  for (const inventoryEntry of INVENTORY) {
    if (inventoryEntry.root !== '.') {
      await fs.mkdir(path.join(rootDir, inventoryEntry.root), { recursive: true })
    }
    for (const file of inventoryEntry.files ?? []) {
      const filePath = path.join(rootDir, file)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, contentForExtension(path.extname(file)), 'utf8')
    }
  }
  return rootDir
}

async function scanFixture(mutator) {
  const rootDir = await createFixture()
  try {
    await mutator(rootDir)
    return await scanProject(rootDir)
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true })
  }
}

async function run() {
  const clean = await scanFixture(async (rootDir) => {
    await fs.writeFile(path.join(rootDir, 'package-lock.json'), `{"note":"${legacyPlatformIdentifier}"}\n`, 'utf8')
    await fs.mkdir(path.join(rootDir, 'docs', 'assets'), { recursive: true })
    await fs.writeFile(path.join(rootDir, 'docs', 'assets', 'evidence.png'), legacyPlatformIdentifier, 'utf8')
  })
  assert.deepEqual(clean.errors, [], 'a complete clean fixture must have no inventory or read errors')
  assert.deepEqual(clean.findings, [], 'a clean fixture must produce a green scan')
  assert.deepEqual(
    clean.excluded.filter(({ path: excludedPath }) => excludedPath === 'docs/assets/evidence.png' || excludedPath === 'package-lock.json'),
    [
      { path: 'docs/assets/evidence.png', reason: 'binary evidence asset, not text source' },
      { path: 'package-lock.json', reason: 'generated dependency lock data' },
    ],
    'generated lock data and binary evidence must be excluded for explicit reasons',
  )

  const platformBranch = await scanFixture(async (rootDir) => {
    await fs.writeFile(
      path.join(rootDir, 'src', 'platform.ts'),
      `if (process.platform === '${legacyPlatformIdentifier}') {\n  console.log('legacy path')\n}\n`,
      'utf8',
    )
  })
  assert.equal(platformBranch.findings.length, 1, 'one forbidden platform branch must make the scan red')
  assert.deepEqual(
    platformBranch.findings[0],
    {
      category: 'legacy platform identifier',
      column: 27,
      line: 1,
      path: 'src/platform.ts',
      rule: 'desktop-platform-identifier',
    },
    'the platform finding must identify an actionable source location',
  )

  const renamedFile = await scanFixture(async (rootDir) => {
    const original = path.join(rootDir, 'src', 'platform.ts')
    const renamed = path.join(rootDir, 'src', 'renamed-bridge.ts')
    await fs.writeFile(original, `const target = '${desktopOperatingSystemName}'\n`, 'utf8')
    await fs.rename(original, renamed)
  })
  assert.equal(renamedFile.findings.length, 1, 'renaming a source file must not evade the inventory')
  assert.equal(renamedFile.findings[0].path, 'src/renamed-bridge.ts')
  assert.equal(renamedFile.findings[0].line, 1)

  const commentedLine = await scanFixture(async (rootDir) => {
    await fs.writeFile(
      path.join(rootDir, 'scripts', 'commented-legacy.mjs'),
      `// if (process.platform === '${legacyPlatformIdentifier}') { }\n`,
      'utf8',
    )
  })
  assert.equal(commentedLine.findings.length, 1, 'commented-out forbidden lines must remain visible to the scan')
  assert.equal(commentedLine.findings[0].path, 'scripts/commented-legacy.mjs')

  const packagingAndModifier = await scanFixture(async (rootDir) => {
    await fs.writeFile(path.join(rootDir, 'docs', 'packaging.md'), `release output: ${diskImagePackage}; target: ${diskImagePackageName}\n`, 'utf8')
    await fs.writeFile(
      path.join(rootDir, 'site', 'shortcuts.html'),
      `<p>${commandModifierGlyph}+F ${compactCommandModifier}+K ${longCommandModifier}+P</p>\n`,
      'utf8',
    )
    await fs.writeFile(path.join(rootDir, 'docs', `legacy${diskImagePackage}`), 'binary package', 'utf8')
  })
  assert.equal(packagingAndModifier.findings.length, 6, 'packaging names and command-key forms must all be rejected')
  assert.deepEqual(
    packagingAndModifier.findings.map(({ path: findingPath, rule }) => [findingPath, rule]),
    [
      [`docs/legacy${diskImagePackage}`, 'platform-package-file'],
      ['docs/packaging.md', 'disk-image-package'],
      ['docs/packaging.md', 'disk-image-package-name'],
      ['site/shortcuts.html', 'keyboard-command-modifier'],
      ['site/shortcuts.html', 'keyboard-command-modifier'],
      ['site/shortcuts.html', 'keyboard-command-modifier'],
    ],
  )

  const unreadable = await createFixture()
  try {
    const unreadablePath = path.resolve(unreadable, 'docs', 'unreadable.md')
    await fs.writeFile(unreadablePath, '# unreadable\n', 'utf8')
    const report = await scanProject(unreadable, {
      readFile: async (filePath, encoding) => {
        if (path.resolve(filePath) === unreadablePath) {
          throw new Error('synthetic read refusal')
        }
        return fs.readFile(filePath, encoding)
      },
    })
    assert.equal(report.errors.length, 1, 'an inventoried unreadable file must make the scan red')
    assert.equal(report.errors[0].path, 'docs/unreadable.md')
    assert.match(report.errors[0].message, /file is unreadable: synthetic read refusal/u)
  } finally {
    await fs.rm(unreadable, { recursive: true, force: true })
  }

  console.log('PASS check-windows-only fixture coverage')
}

await run()
