import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const JSX_IN_TS_ALLOWLIST = new Set([
  'src/renderer/components/ShellSessionVocabulary.boundaries.test.tsx',
]);

function loadEsbuild(root) {
  const packageJson = path.join(root, 'node_modules', 'esbuild', 'package.json');
  const localRequire = createRequire(path.join(root, 'package.json'));
  const resolved = localRequire.resolve(packageJson);
  return createRequire(resolved)(path.join(path.dirname(resolved), 'lib', 'main.js'));
}

export function loaderForPath(file) {
  const normalized = file.replaceAll('\\', '/');
  if (normalized.endsWith('.tsx')) return 'tsx';
  if (normalized.endsWith('.ts')) {
    return JSX_IN_TS_ALLOWLIST.has(normalized) ? 'tsx' : 'ts';
  }
  throw new Error(`Unknown tracked source extension: ${file}`);
}

export function validateSourcePaths(files, { requireAllowlist = true } = {}) {
  const normalized = files.map((file) => file.replaceAll('\\', '/'));
  const unknown = normalized.filter((file) => !file.endsWith('.ts') && !file.endsWith('.tsx'));
  if (unknown.length) {
    throw new Error(`Unknown tracked source extension: ${unknown.join(', ')}`);
  }
  if (requireAllowlist) {
    for (const allowed of JSX_IN_TS_ALLOWLIST) {
      if (!normalized.includes(allowed)) throw new Error(`Allowlisted source path vanished: ${allowed}`);
    }
  }
  return normalized;
}

export function parseSource({ root, files, esbuild = loadEsbuild(root), requireAllowlist = true }) {
  const sourceFiles = validateSourcePaths(files, { requireAllowlist });
  const failures = [];
  for (const file of sourceFiles) {
    try {
      esbuild.transformSync(readFileSync(path.join(root, file), 'utf8'), {
        loader: loaderForPath(file),
        sourcefile: file,
        logLevel: 'silent',
      });
    } catch (error) {
      const first = error?.errors?.[0];
      failures.push({
        file,
        isTest: /(?:^|[/.])[^/]+\.(?:test|spec)\.(?:ts|tsx)$/.test(file),
        line: first?.location?.line ?? 0,
        column: first?.location?.column ?? 0,
        text: first?.text ?? String(error),
      });
    }
  }
  return {
    checked: sourceFiles.length,
    failures,
    productionFailures: failures.filter((item) => !item.isTest).length,
    testFailures: failures.filter((item) => item.isTest).length,
  };
}

export function trackedSourceFiles(root) {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root });
  const tracked = output.toString('utf8').split('\0').filter(Boolean);
  // A deliberate sparse checkout still reports every tracked path through `git ls-files`,
  // while files outside its cone are absent on disk. Parse only materialized source files so the
  // checker does not turn an intentional no-submodules/sparse checkout into twenty-five false
  // ENOENT poke guys. The explicit JSX allowlist remains fail-closed when its path is present.
  return selectTrackedSourceFiles(tracked).filter((file) => existsSync(path.join(root, file)));
}

export function selectTrackedSourceFiles(files) {
  return validateSourcePaths(files.filter((file) => file.endsWith('.ts') || file.endsWith('.tsx')));
}

export function run(root = process.cwd()) {
  const result = parseSource({ root, files: trackedSourceFiles(root) });
  const report = {
    schemaVersion: 1,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    checked: result.checked,
    failures: result.failures.length,
    productionFailures: result.productionFailures,
    testFailures: result.testFailures,
    items: result.failures,
  };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/check-source-parse.mjs')) {
  const rootIndex = process.argv.indexOf('--root');
  const root = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : process.cwd();
  const report = run(root);
  process.exitCode = report.failures === 0 ? 0 : 1;
}
