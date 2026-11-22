import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { scanSnapshotPages } from '../dist/snapshotScan.js';

const fakeAsset = i => ({
  id: 'ph-' + i,
  type: 'image',
  createdAt: '2026-11-22T00:00:00.000Z',
  width: 3000,
  height: 2000
});

function fakePlugin(total, overrides = {}) {
  const log = { begun: 0, end: [], page: [], requested: 0 };
  const plugin = {
    async authorizationStatus() { return { status: 'authorized' }; },
    async requestAuthorization() { log.requested++; return { status: 'authorized' }; },
    async beginAssetScan() { log.begun++; return { snapshotToken: 'fresh-scan', total }; },
    async getAssetsPage({ offset, limit, snapshotToken }) {
      log.page.push({ offset, limit, snapshotToken });
      const end = Math.min(total, offset + limit);
      return { total, nextOffset: end < total ? end : null,
        assets: Array.from({ length: end - offset }, (_, i) => fakeAsset(offset + i)) };
    },
    async endAssetScan({ snapshotToken }) { log.end.push(snapshotToken); return { ended: true }; },
    ...overrides
  };
  return { plugin, log };
}

test('paginates >10,000 items under a fresh native token, with bounded pages and complete progress only after durable writes', async () => {
  const { plugin, log } = fakePlugin(10005);
  let saved = 0;
  const progress = [];
  const result = await scanSnapshotPages({
    plugin, pageSize: 201, maxItems: 20000,
    async onPage(page) {
      assert.equal(page.offset, saved);
      assert.ok(page.assets.length <= 201);
      saved += page.assets.length;
    },
    onProgress(p) { assert.equal(saved, p.processed); progress.push(p.processed); }
  });
  assert.equal(result.processed, 10005);
  assert.equal(result.complete, true);
  assert.equal(result.state, 'complete');
  assert.equal(saved, 10005);
  assert.equal(progress.at(-1), 10005);
  assert.equal(log.begun, 1);
  assert.deepEqual(log.end, ['fresh-scan']);
  assert.equal(log.page.at(-1).offset, 10005 - 156);
  assert.ok(log.page.every(p => p.snapshotToken === 'fresh-scan' && p.limit <= 201));
});

test('maxItems is an explicit partial limit, not false completion of the native library', async () => {
  const { plugin } = fakePlugin(1500);
  const result = await scanSnapshotPages({ plugin, maxItems: 500, pageSize: 200,
    onPage() {} });
  assert.deepEqual({state:result.state,complete:result.complete,processed:result.processed,total:result.total},
    {state:'limit_reached',complete:false,processed:500,total:1500});
});

test('stops after persisted page without requesting the next page', async () => {
  const { plugin, log } = fakePlugin(700);
  let saved = 0;
  const result = await scanSnapshotPages({
    plugin, pageSize: 100,
    onPage({assets}) { saved += assets.length; },
    shouldStop() { return saved >= 100; }
  });
  assert.equal(result.state, 'stopped');
  assert.equal(result.processed, 100);
  assert.equal(log.page.length, 1);
  assert.equal(log.end.length, 1);
});

test('does not report progress or scan further after persistence fails', async () => {
  const { plugin, log } = fakePlugin(500);
  const reported = [];
  await assert.rejects(scanSnapshotPages({
    plugin, pageSize: 100,
    onPage({offset}) { if (offset === 100) throw Error('storage quota'); },
    onProgress(p) { reported.push(p.processed); }
  }), /storage quota/);
  assert.deepEqual(reported, [100]);
  assert.equal(log.page.length, 2);
  assert.equal(log.end.length, 1);
});

test('expired snapshot errors fail closed, even when endAssetScan also rejects', async () => {
  const { plugin, log } = fakePlugin(400, {
    async getAssetsPage() { const e = Error('SCAN_EXPIRED'); e.code = 'SCAN_EXPIRED'; throw e; },
    async endAssetScan({snapshotToken}) { log.end.push(snapshotToken); throw Error('expired cleanup'); }
  });
  await assert.rejects(scanSnapshotPages({ plugin, onPage() {} }),
    e => e.code === 'SCAN_EXPIRED');
  assert.deepEqual(log.end, ['fresh-scan']);
});

test('rejects duplicate IDs across pages before saving the affected page', async () => {
  const { plugin, log } = fakePlugin(201);
  const original = plugin.getAssetsPage;
  plugin.getAssetsPage = async args => {
    const result = await original(args);
    if (args.offset === 200) result.assets[0].id = 'ph-5';
    return result;
  };
  let saved = 0;
  await assert.rejects(scanSnapshotPages({plugin, pageSize:200, onPage({assets}) {saved += assets.length;}}),
    e => e.code === 'INVALID_NATIVE_PAGE');
  assert.equal(saved, 200);
  assert.equal(log.end.length, 1);
});

test('detects changed totals, malformed cursors, bad records and missing offsets before progress', async () => {
  for (const modify of [
    p => ({...p, total: p.total + 1}),
    p => ({...p, nextOffset: 999}),
    p => ({...p, assets: p.assets.slice(1)}),
    p => ({...p, assets: [{...p.assets[0], width: -1}, ...p.assets.slice(1)]})
  ]) {
    const { plugin } = fakePlugin(3);
    const original = plugin.getAssetsPage;
    plugin.getAssetsPage = async args => modify(await original(args));
    let writes = 0;
    await assert.rejects(scanSnapshotPages({ plugin, onPage() {writes++;} }),
      e => e.code === 'INVALID_NATIVE_PAGE');
    assert.equal(writes, 0);
  }
});

test('denied and limited permissions cannot begin native reads', async () => {
  for (const status of ['denied','limited']) {
    const { plugin, log } = fakePlugin(10, {
      async authorizationStatus() { return { status }; }
    });
    await assert.rejects(scanSnapshotPages({plugin, onPage() {}}),
      e => e.code === 'PHOTOS_FULL_ACCESS_REQUIRED');
    assert.equal(log.begun, 0);
  }
});

test('notDetermined requests full access once; empty libraries are complete and cleaned up', async () => {
  const { plugin, log } = fakePlugin(0, {
    async authorizationStatus() { return {status:'notDetermined'}; }
  });
  const r = await scanSnapshotPages({plugin, onPage() {}});
  assert.equal(r.state,'complete');
  assert.equal(r.processed,0);
  assert.equal(log.requested,1);
  assert.deepEqual(log.end,['fresh-scan']);
});

test('invalid configurations fail before prompting Photos or creating scan', async () => {
  const {plugin, log}=fakePlugin(10);
  for(const pageSize of [0,251,1.5]){
    await assert.rejects(scanSnapshotPages({plugin,onPage() {},pageSize}),
      e=>e.code==='INVALID_SCAN_CONFIGURATION');
  }
  assert.equal(log.begun,0);
});

test('published JS and source JS scanner are byte-identical', () => {
  assert.equal(
    fs.readFileSync(new URL('../src/snapshotScan.js', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../dist/snapshotScan.js', import.meta.url), 'utf8')
  );
  assert.equal(
    fs.readFileSync(new URL('../src/snapshotScan.d.ts', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../dist/snapshotScan.d.ts', import.meta.url), 'utf8')
  );
});
