#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addNoindex } from './apply-pages-noindex.mjs';

const artifact = await mkdtemp(join(tmpdir(), 'nodeterm-pages-noindex-'));
try {
  const pages = {
    'comment-script.html': '<html><head><!-- <meta name="robots" content="index"> --><script>const fake = \'<meta name="robots" content="index">\';</script></head><body></body></html>',
    'unquoted.html': '<html><head><meta name=robots content=index></head><body></body></html>',
    'outside-head.html': '<html><head></head><body><meta name=robots content=index></body></html>',
    'specific-crawler.html': '<html><head><meta name="robots" content="index"><meta name="googlebot" content="index, follow"></head></html>',
  };
  for (const [name, source] of Object.entries(pages)) {
    await writeFile(join(artifact, name), addNoindex(source, name), 'utf8');
  }
  assert.throws(
    () => addNoindex('<html><head><meta name="robots" content="index"><meta name="robots" content="noindex"></head></html>', 'duplicate.html'),
    /more than one effective robots meta tag/,
  );

  const verifier = join(dirname(fileURLToPath(import.meta.url)), 'verify_pages_noindex.py');
  const python = process.platform === 'win32' ? 'py' : 'python3';
  const arguments_ = process.platform === 'win32' ? ['-3', verifier, artifact] : [verifier, artifact];
  execFileSync(python, arguments_, { stdio: 'pipe' });
  console.log('Pages noindex regressions passed; Python HTMLParser verified four fixture pages.');
} finally {
  await rm(artifact, { recursive: true, force: true });
}
