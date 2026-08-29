import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loaderForPath, parseSource, selectTrackedSourceFiles, validateSourcePaths } from './check-source-parse.mjs';

const fixture = 'src/renderer/components/ShellSessionVocabulary.boundaries.test.tsx';
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

describe('source parser loader boundaries', () => {
  it('the exact JSX-bearing .tsx fixture uses the allowlisted tsx loader', () => {
    expect(loaderForPath(fixture)).toBe('tsx');
    expect(parseSource({ root, files: [fixture], esbuild: parserDouble }).failures).toHaveLength(0);
  });

  it('the same JSX bytes are red under ts', () => {
    expect(() => parserDouble.transformSync(fixtureText, { loader: 'ts' })).toThrow();
  });

  it('renamed paths are not allowlisted', () => {
    const renamed = fixture.replace('ShellSessionVocabulary', 'RenamedShellSessionVocabulary');
    expect(loaderForPath(renamed)).toBe('tsx');
    expect(() => validateSourcePaths([renamed])).toThrow(/Allowlisted source path vanished/);
    expect(() => validateSourcePaths([renamed, 'src/example.js'])).toThrow(/Unknown tracked source extension/);
  });

  it('normal TypeScript and TSX paths select their own loaders', () => {
    expect(loaderForPath('src/core/example.ts')).toBe('ts');
    expect(loaderForPath('src/renderer/example.tsx')).toBe('tsx');
  });

  it('selects every tracked TypeScript path, including the repository root', () => {
    expect(selectTrackedSourceFiles([
      'vitest.config.ts',
      'src/core/example.ts',
      'src/renderer/example.tsx',
      fixture,
      'README.md',
      'scripts/example.js',
    ])).toEqual([
      'vitest.config.ts',
      'src/core/example.ts',
      'src/renderer/example.tsx',
      fixture,
    ]);
  });

  it('reports deterministic totals and machine-readable failure records', () => {
    const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'source-parse-'));
    writeFileSync(path.join(fixtureRoot, 'good.ts'), 'export const good = 1;\n');
    writeFileSync(path.join(fixtureRoot, 'bad.ts'), 'export const bad = <broken>;\n');
    const report = parseSource({
      root: fixtureRoot,
      files: ['good.ts', 'bad.ts'],
      esbuild: parserDouble,
      requireAllowlist: false,
    });
    expect(report.checked).toBe(2);
    expect(report.failures).toHaveLength(1);
    expect(report.productionFailures).toBe(1);
    expect(report.testFailures).toBe(0);
    expect(report.failures[0]).toEqual({
      file: 'bad.ts',
      isTest: false,
      line: 1,
      column: 1,
      text: 'JSX syntax requires the tsx loader',
    });
  });
});
