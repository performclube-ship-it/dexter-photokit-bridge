import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const swift = fs.readFileSync(new URL('../ios/Plugin/DexterPhotoKitPlugin.swift', import.meta.url), 'utf8');
const section = (start, end) => swift.split(start)[1]?.split(end)[0] ?? '';
const verifyOrdered = (source, ...markers) => {
  let last = -1;
  for (const marker of markers) {
    const at = source.indexOf(marker, last + 1);
    assert.ok(at > last, 'expected ordered marker: ' + marker);
    last = at;
  }
};
const accessGate = 'guard !self.permissionRevoked(call) else { self.releaseAlbumMutation(); return }';

test('album creation refuses revoked authorization before and after slow enumeration', () => {
  const body = section('@objc func createAlbum', '@objc func isAlbumWritable');
  verifyOrdered(body,
    'guard acquireAlbumMutation(call) else { return }',
    'DispatchQueue.global(qos: .userInitiated).async {',
    accessGate,
    'let existing = PHAssetCollection.fetchAssetCollections(',
    'for i in 0..<existing.count',
    accessGate,
    'self.photoLibrary.performChanges({');
  assert.equal(body.split(accessGate).length - 1, 2);
});

test('album creation does not reveal its identifier after authorization changes during PhotoKit write', () => {
  const body = section('@objc func createAlbum', '@objc func isAlbumWritable');
  verifyOrdered(body,
    'completionHandler: { success, error in',
    'defer { self.releaseAlbumMutation() }',
    'guard !self.permissionRevoked(call) else { return }',
    'guard success, let albumId',
    'PHAssetCollection.fetchAssetCollections(withLocalIdentifiers:',
    'guard !self.permissionRevoked(call) else { return }',
    'call.resolve(["id": albumId])');
});

test('existing-asset mutation rechecks permission after async fetch and membership read', () => {
  const body = section('@objc func addExistingAssets', '@objc func verifyAlbumMembership');
  verifyOrdered(body,
    'guard acquireAlbumMutation(call) else { return }',
    'let fetched = self.fetchAssetsByID(ids)',
    accessGate,
    'let presentBefore = self.membership(in: album, ids: ids)',
    accessGate,
    'let toAdd =',
    'if toAdd.isEmpty');
  assert.match(body, /if toAdd\.isEmpty \{[\s\S]*?guard !self\.permissionRevoked\(call\) else \{ self\.releaseAlbumMutation\(\); return \}[\s\S]*?call\.resolve\(/);
  verifyOrdered(body,
    'if toAdd.isEmpty', 
    'guard !self.permissionRevoked(call) else { self.releaseAlbumMutation(); return }\n                self.releaseAlbumMutation()',
    '// Do not start a PhotoKit write after',
    accessGate,
    'self.photoLibrary.performChanges({');
});

test('PhotoKit completion only reports verified membership with current permission', () => {
  const body = section('@objc func addExistingAssets', '@objc func verifyAlbumMembership');
  verifyOrdered(body,
    'completionHandler: { success, error in',
    'defer { self.releaseAlbumMutation() }',
    'guard !self.permissionRevoked(call) else { return }',
    'guard success else',
    'let presentAfter = self.membership(in: album, ids: ids)',
    'guard !self.permissionRevoked(call) else { return }',
    'guard presentAfter.count',
    'call.resolve([');
  assert.match(body, /request\.addAssets\(toAdd as NSArray\)/);
  for (const forbidden of ['PHAssetChangeRequest', 'PHAssetCreationRequest', 'deleteAssets(', 'removeAssets(']) {
    assert.ok(!swift.includes(forbidden), 'original-photo integrity: ' + forbidden);
  }
});
