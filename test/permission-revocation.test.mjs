import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const swift = fs.readFileSync(new URL('../ios/Plugin/DexterPhotoKitPlugin.swift', import.meta.url), 'utf8');
const block = (start, end) => swift.split(start)[1]?.split(end)[0] ?? '';
const before = (body, left, right) => {
  assert.ok(body.includes(left), 'missing ' + left);
  assert.ok(body.includes(right), 'missing ' + right);
  assert.ok(body.indexOf(left) < body.lastIndexOf(right), left + ' must precede ' + right);
};

test('permission change has one explicit error and checks current full Photos authorization', () => {
  const helper = block('private func permissionRevoked(_ call: CAPPluginCall) -> Bool {', 'private func acquireAlbumMutation');
  assert.match(helper, /PHPhotoLibrary\.authorizationStatus\(for: \.readWrite\) == \.authorized/);
  assert.match(helper, /"PHOTOS_PERMISSION_CHANGED"/);
  assert.match(helper, /return true/);
});

test('snapshot initiation rechecks permission after asynchronous enumeration and clears token on loss', () => {
  const body = block('@objc func beginAssetScan', '@objc func endAssetScan');
  before(body, 'let fetched = PHAsset.fetchAssets', 'guard !self.permissionRevoked(call) else { return }\n            let token');
  assert.match(body, /if self\.permissionRevoked\(call\) \{[\s\S]*?self\.activeScan = nil[\s\S]*?return/);
  before(body, 'if self.permissionRevoked(call)', 'call.resolve(["snapshotToken"');
});

test('metadata paging and list operations block late delivery after lost permission', () => {
  const page = block('@objc func getAssetsPage', '@objc func listAlbums');
  const albums = block('@objc func listAlbums', '@objc func createAlbum');
  const accessible = block('@objc func areAssetsAccessible', 'private func acquirePilotPreview');
  const membership = block('@objc func verifyAlbumMembership', 'private final class AlbumIdentifierBox');
  before(page, 'let total = all.count', 'guard !self.permissionRevoked(call) else { return }\n            call.resolve([');
  before(albums, 'result.append(', 'guard !self.permissionRevoked(call) else { return }\n            call.resolve(');
  before(accessible, 'let fetched =', 'guard !self.permissionRevoked(call) else { return }\n            call.resolve(');
  before(membership, 'let present =', 'guard !self.permissionRevoked(call) else { return }\n            call.resolve(');
});

test('bounded photo previews and Vision check permission per item and before returning pixels or labels', () => {
  const preview = block('@objc func getPilotPreviews', '@objc func classifyPilotAssets');
  const classify = block('@objc func classifyPilotAssets', '@objc func addExistingAssets');
  for (const [body, payload] of [[preview, 'previews'], [classify, 'results']]) {
    assert.match(body, /for id in ids \{\s*guard !self\.permissionRevoked\(call\) else \{ return \}/);
    before(body, 'guard !self.permissionRevoked(call) else { return }\n            call.resolve', 'call.resolve(["' + payload + '"');
    assert.match(body, /options\.isNetworkAccessAllowed = false/);
  }
});

test('closing a scan releases its snapshot even if authorization is revoked', () => {
  const end = block('@objc func endAssetScan', '@objc func getAssetsPage');
  before(end, 'activeScan = nil', 'guard !permissionRevoked(call) else { return }');
  before(end, 'guard !permissionRevoked(call) else { return }', 'call.resolve(["ended": true])');
});

test('permission race hardening does not add any mutating or copying Photos API', () => {
  for (const api of ['PHAssetChangeRequest', 'PHAssetCreationRequest', 'deleteAssets(', 'removeAssets(', 'savePhoto(']) {
    assert.ok(!swift.includes(api), 'forbidden PhotoKit API: ' + api);
  }
});
