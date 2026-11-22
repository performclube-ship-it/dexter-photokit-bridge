import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const root = new URL('../', import.meta.url);
const swift = fs.readFileSync(new URL('../ios/Plugin/DexterPhotoKitPlugin.swift', import.meta.url), 'utf8');
const definitions = fs.readFileSync(new URL('../dist/definitions.d.ts', import.meta.url), 'utf8');
const metadata = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expected = ['authorizationStatus', 'requestAuthorization', 'getAssetsPage', 'beginAssetScan', 'endAssetScan', 'listAlbums', 'createAlbum', 'isAlbumWritable', 'areAssetsAccessible', 'getPilotPreviews', 'addExistingAssets', 'verifyAlbumMembership'];
test('all native methods match JS bridge', () => {
  for (const name of expected) {
    assert.match(swift, new RegExp('CAPPluginMethod\\(name: "'+name+'"'));
    assert.match(swift, new RegExp('\\@objc func '+name+'\\('));
    assert.match(definitions, new RegExp(name+'\\('));
  }
});
test('Capacitor version, CocoaPods and deployment target', () => {
  assert.equal(metadata.peerDependencies['@capacitor/core'], '^8.0.0');
  // Capacitor 8.5.3 derives this pod name from the npm package id, not the JS plugin name.
  const podspec = fs.readFileSync(new URL('../DexterPhotokitBridge.podspec', import.meta.url), 'utf8');
  assert.match(podspec, /s\.name = 'DexterPhotokitBridge'/);
  assert.match(podspec, /deployment_target = '15\.5'/);
  assert.match(podspec, /s\.dependency 'Capacitor'/);
  assert.match(podspec, /s\.frameworks = 'Photos'/);
});
test('not even dead-code APIs that could destroy/copy PHAssets are shipped', () => {
  const forbidden = [
    /PHAssetChangeRequest/, /PHAssetCreationRequest/, /deleteAssets\s*\(/,
    /removeAssets\s*\(/, /savePhoto\s*\(/, /creationRequestForAsset\s*\(/
  ];
  for (const pattern of forbidden) assert.doesNotMatch(swift, pattern);
  assert.match(swift, /request\.addAssets\(toAdd as NSArray\)/);
  assert.match(swift, /PHAssetCollectionChangeRequest\.creationRequestForAssetCollection/);
});
test('read-only metadata pagination does not request photo thumbnails or binary data', () => {
  assert.match(swift, /PHAsset\.fetchAssets\(with: self\.scanFetchOptions\(\)\)/);
  const paging = swift.split('@objc func getAssetsPage(_ call: CAPPluginCall) {')[1]
    .split('@objc func listAlbums(_ call: CAPPluginCall) {')[0];
  assert.doesNotMatch(paging, /PHImageManager|requestImage\s*\(|PHCachingImageManager|base64EncodedString/);
  assert.match(swift, /limit <= maxPage/);
});
test('native module uses JS export and only carries iOS assets in package', () => {
  const js = fs.readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.match(js, /registerPlugin\('DexterPhotoKit'\)/);
  assert.ok(metadata.files.includes('ios/'));
  assert.ok(metadata.files.includes('DexterPhotokitBridge.podspec'));
});

test('explicit scan token stays bound to one PHFetchResult and is invalidated on photo-library changes', () => {
  assert.match(swift, /PHPhotoLibraryChangeObserver/);
  assert.match(swift, /photoLibrary\.register\(self\)/);
  assert.match(swift, /photoLibrary\.unregisterChangeObserver\(self\)/);
  assert.match(swift, /photoLibraryDidChange\(_ changeInstance: PHChange\)/);
  assert.match(swift, /activeScan\?\.invalidated = true/);
  assert.match(swift, /let fetched = PHAsset\.fetchAssets\(with: self\.scanFetchOptions\(\)\)/);
  assert.match(swift, /all = scan\.assets/);
  assert.match(swift, /self\.activeScan\?\.token == token && self\.activeScan\?\.invalidated == false/);
  assert.match(swift, /"LIBRARY_CHANGED"/);
  assert.match(definitions, /beginAssetScan\(\): Promise<DexterAssetScan>/);
  assert.match(definitions, /snapshotToken\?: string/);
  assert.match(definitions, /endAssetScan\(input: \{ snapshotToken: string \}\)/);
});
test('changes do not silently fall back to a different snapshot for a supplied token', () => {
  assert.match(swift, /if let token = requestedToken \{/);
  assert.match(swift, /scan\.token == token, !scan\.invalidated/);
  assert.match(swift, /"SCAN_EXPIRED"/);
  assert.match(swift, /else \{\s*\/\/ Backward compatible, but each legacy call has an independent fetch\./);
});

test('explicit malformed snapshotToken cannot downgrade to legacy unsnapshotted paging', () => {
  const body = swift.split('@objc func getAssetsPage(_ call: CAPPluginCall) {')[1]
    .split('@objc func listAlbums(_ call: CAPPluginCall) {')[0];
  assert.match(body, /call\.options\.keys\.contains\("snapshotToken"\)/);
  assert.match(body, /guard let token = call\.getString\("snapshotToken"\)/);
  assert.match(body, /!token\.isEmpty, token\.utf8\.count <= 128/);
  assert.match(body, /"INVALID_SCAN_TOKEN"/);
  assert.match(body, /requestedToken = nil/);
  assert.ok(body.indexOf('if call.options.keys.contains("snapshotToken")') < body.indexOf('DispatchQueue.global(qos: .userInitiated).async'),
    'Invalid inputs must fail synchronously before background photo-library access');
  assert.match(swift, /@objc func endAssetScan[\s\S]*?token\.utf8\.count <= 128/);
});

test('album creation and existing-asset association are single-flight with no silent duplicate album names', () => {
  const create = swift.split('@objc func createAlbum(_ call: CAPPluginCall) {')[1]
    .split('@objc func isAlbumWritable(_ call: CAPPluginCall) {')[0];
  const add = swift.split('@objc func addExistingAssets(_ call: CAPPluginCall) {')[1]
    .split('@objc func verifyAlbumMembership(_ call: CAPPluginCall) {')[0];
  assert.ok(swift.includes('private let albumMutationQueue = DispatchQueue'));
  assert.ok(swift.includes('private var albumMutationInFlight = false'));
  assert.ok(swift.includes('"ALBUM_MUTATION_BUSY"'));
  assert.ok(swift.includes('albumMutationQueue.sync { () -> Bool in'));
  assert.ok(swift.includes('albumMutationInFlight = true'));
  assert.ok(swift.includes('private func releaseAlbumMutation()'));
  assert.ok(swift.includes('albumMutationQueue.sync { albumMutationInFlight = false }'));
  for (const body of [create, add]) {
    assert.ok(body.includes('guard acquireAlbumMutation(call) else { return }'));
    assert.ok(body.includes('defer { self.releaseAlbumMutation() }'));
    assert.ok(body.indexOf('guard acquireAlbumMutation(call)') < body.indexOf('self.photoLibrary.performChanges('));
  }
  assert.ok(create.includes('PHAssetCollection.fetchAssetCollections('));
  assert.ok(create.includes('options: [.caseInsensitive, .diacriticInsensitive]'));
  assert.ok(create.includes('"ALBUM_ALREADY_EXISTS"'));
  assert.ok(create.indexOf('"ALBUM_ALREADY_EXISTS"') < create.indexOf('self.photoLibrary.performChanges('));
  assert.ok(create.includes('self.releaseAlbumMutation()'));
  assert.ok(add.includes('self.releaseAlbumMutation()'));
  assert.ok(add.includes('if toAdd.isEmpty {'));
  const completion = add.slice(add.indexOf('completionHandler:'));
  assert.ok(completion.indexOf('let presentAfter = self.membership') >= 0);
  assert.ok(completion.indexOf('let presentAfter = self.membership') < completion.indexOf('call.resolve('));
});

test('native write pilot cannot bypass the reviewed ten-photo limit while read checks still allow up to 250', () => {
  const add = swift.split('@objc func addExistingAssets(_ call: CAPPluginCall) {')[1]
    .split('@objc func verifyAlbumMembership(_ call: CAPPluginCall) {')[0];
  const readable = swift.split('@objc func areAssetsAccessible(_ call: CAPPluginCall) {')[1]
    .split('    private func acquirePilotPreview(_ call: CAPPluginCall) -> Bool {')[0];
  assert.match(swift, /private let maxPilotWrite = 10/);
  assert.match(swift, /private let maxAlbumBatch = 250/);
  assert.match(add, /guard ids\.count <= maxPilotWrite else \{/);
  assert.match(add, /"PILOT_WRITE_LIMIT"/);
  assert.ok(add.indexOf('guard ids.count <= maxPilotWrite') < add.indexOf('guard acquireAlbumMutation(call)'));
  assert.ok(add.indexOf('guard ids.count <= maxPilotWrite') < add.indexOf('self.photoLibrary.performChanges('));
  assert.doesNotMatch(readable, /maxPilotWrite/);
});

test('already-present album no-op must independently verify membership before reporting success', () => {
  const add = swift.split('@objc func addExistingAssets(_ call: CAPPluginCall) {')[1]
    .split('@objc func verifyAlbumMembership(_ call: CAPPluginCall) {')[0];
  const noOp = add.split('if toAdd.isEmpty {')[1]
    .split('self.photoLibrary.performChanges(')[0];
  assert.match(noOp, /let confirmed = self\.membership\(in: album, ids: ids\)/);
  assert.match(noOp, /guard confirmed\.count == ids\.count else \{/);
  assert.match(noOp, /"ALBUM_NOOP_UNVERIFIED"/);
  assert.ok(noOp.indexOf('let confirmed =') < noOp.indexOf('call.resolve('));
  assert.ok(noOp.indexOf('guard confirmed.count') < noOp.indexOf('self.releaseAlbumMutation()'));
  assert.ok(noOp.indexOf('"ALBUM_NOOP_UNVERIFIED"') < noOp.indexOf('call.resolve('));
});

test('native scan close rejects invalidated sessions and releases retained assets', () => {
  const close = swift.split('@objc func endAssetScan(_ call: CAPPluginCall) {')[1]
    .split('@objc func getAssetsPage(_ call: CAPPluginCall) {')[0];
  assert.match(close, /let outcome = scanStateQueue\.sync/);
  assert.match(close, /return \(true, scan\.invalidated\)/);
  assert.match(close, /activeScan = nil/);
  assert.match(close, /guard !outcome\.invalidated else/);
  assert.match(close, /"LIBRARY_CHANGED"/);
  assert.ok(close.indexOf('guard !outcome.invalidated') < close.indexOf('call.resolve(["ended": true])'));
});
