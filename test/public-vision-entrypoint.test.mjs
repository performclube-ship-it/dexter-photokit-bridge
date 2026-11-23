import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('local Vision classifier is reachable from the public JS and source entrypoints', () => {
  const src = read('../src/index.ts');
  const dist = read('../dist/index.js');
  assert.match(src, /^export \{ classifyLocalPages \} from '\.\/progressiveClassification\.js';$/m);
  assert.match(dist, /^export \{ classifyLocalPages \} from '\.\/progressiveClassification\.js';$/m);
  assert.match(read('../src/progressiveClassification.js'), /^export async function classifyLocalPages\(/m);
  assert.equal(read('../src/progressiveClassification.js'), read('../dist/progressiveClassification.js'));
  assert.match(dist, /registerPlugin\('DexterPhotoKit'\)/);
});

test('public declarations expose opt-in classification and its safety contract types', () => {
  assert.match(read('../src/index.ts'), /^export type \* from '\.\/progressiveClassification\.js';$/m);
  assert.match(read('../dist/index.d.ts'), /^export \{ classifyLocalPages \} from '\.\/progressiveClassification';$/m);
  assert.match(read('../dist/index.d.ts'), /^export type \* from '\.\/progressiveClassification';$/m);
  const declaration = read('../dist/progressiveClassification.d.ts');
  for (const name of ['LocalVisionOptions', 'LocalVisionOutcome', 'LocalVisionBridge', 'LocalVisionResult', 'LocalVisionProgress']) {
    assert.match(declaration, new RegExp('export interface ' + name + '\\b'));
  }
  assert.match(declaration, /onReviewBatch\(/);
  assert.match(declaration, /classifyLocalPages\(options: LocalVisionOptions\)/);
  assert.equal(read('../src/progressiveClassification.d.ts'), declaration);
});

test('the published package export remains the DEXTER bridge, never a separate app', () => {
  const pkg = JSON.parse(read('../package.json'));
  assert.equal(pkg.exports['.'].import, './dist/index.js');
  assert.equal(pkg.exports['.'].types, './dist/index.d.ts');
  assert.ok(pkg.files.includes('dist/'));
  assert.ok(pkg.files.includes('ios/'));
});
