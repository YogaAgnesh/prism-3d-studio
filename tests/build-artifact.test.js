import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';

test('offline artifact does not reinsert source script tags through replacement strings', async () => {
  const html = await readFile(new URL('../dist/3d-viz-studio.html', import.meta.url), 'utf8');
  assert.equal((html.match(/data-inline=/g) ?? []).length, 0);
  assert.equal((html.match(/<script[^>]+src=/g) ?? []).length, 0);
  assert.equal((html.match(/<link[^>]+rel=["']stylesheet["']/g) ?? []).length, 0);
});

test('offline artifact is newer than every bundled application source', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const artifact = await stat(path.join(root, 'dist', '3d-viz-studio.html'));
  const sourceFiles = [];
  const walk = (directory) => readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath); else if (/\.(js|css|html)$/.test(entry.name)) sourceFiles.push(fullPath);
  });
  walk(path.join(root, 'src'));
  sourceFiles.push(path.join(root, 'index.html'), path.join(root, 'scripts', 'build.mjs'));
  const sourceStats = await Promise.all(sourceFiles.map((file) => stat(file)));
  const newestSource = Math.max(...sourceStats.map((item) => item.mtimeMs));
  assert.ok(artifact.mtimeMs >= newestSource, 'The standalone HTML is stale; run npm run build before release verification.');
});
