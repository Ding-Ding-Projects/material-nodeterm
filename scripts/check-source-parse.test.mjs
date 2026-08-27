import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loaderForPath, parseSource, selectTrackedSourceFiles, validateSourcePaths } from './check-source-parse.mjs';

const fixture = 'src/renderer/components/ShellSessionVocabulary.boundaries.test.ts';
const root = process.cwd();
const fixtureText = readFileSync(fixture, 'utf8');
const parserDouble = {
  transformSync(source, options) {
    if (options.loader === 'ts' && source.includes('<')) {
      const error = new Error('JSX syntax requires the tsx loader');
      error.errors = [{ location: { line: 1, column: 1 }, text: error.message }];
      throw error;
    }
  },
};

test('the exact JSX-bearing .ts fixture uses the allowlisted tsx loader', () => {
  assert.equal(loaderForPath(fixture), 'tsx');
  assert.equal(parseSource({ root, files: [fixture], esbuild: parserDouble }).failures.length, 0);
});

test('the same JSX bytes are red under ts', () => {
  assert.throws(() => parserDouble.transformSync(fixtureText, { loader: 'ts' }));
});

test('renamed paths are not allowlisted', () => {
  const renamed = fixture.replace('ShellSessionVocabulary', 'RenamedShellSessionVocabulary');
  assert.equal(loaderForPath(renamed), 'ts');
  assert.throws(() => validateSourcePaths([renamed]), /Allowlisted source path vanished/);
  assert.throws(() => validateSourcePaths([renamed, 'src/example.js']), /Unknown tracked source extension/);
});

test('normal TypeScript and TSX paths select their own loaders', () => {
  assert.equal(loaderForPath('src/core/example.ts'), 'ts');
  assert.equal(loaderForPath('src/renderer/example.tsx'), 'tsx');
});

test('selects every tracked TypeScript path, including the repository root', () => {
  assert.deepEqual(selectTrackedSourceFiles([
    'vitest.config.ts',
    'src/core/example.ts',
    'src/renderer/example.tsx',
    fixture,
    'README.md',
    'scripts/example.js',
  ]), [
    'vitest.config.ts',
    'src/core/example.ts',
    'src/renderer/example.tsx',
    fixture,
  ]);
});

test('reports deterministic totals and machine-readable failure records', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'source-parse-'));
  writeFileSync(path.join(fixtureRoot, 'good.ts'), 'export const good = 1;\n');
  writeFileSync(path.join(fixtureRoot, 'bad.ts'), 'export const bad = <broken>;\n');
  const report = parseSource({
    root: fixtureRoot,
    files: ['good.ts', 'bad.ts'],
    esbuild: parserDouble,
    requireAllowlist: false,
  });
  assert.equal(report.checked, 2);
  assert.equal(report.failures.length, 1);
  assert.equal(report.productionFailures, 1);
  assert.equal(report.testFailures, 0);
  assert.deepEqual(report.failures[0], {
    file: 'bad.ts',
    isTest: false,
    line: 1,
    column: 1,
    text: 'JSX syntax requires the tsx loader',
  });
});
