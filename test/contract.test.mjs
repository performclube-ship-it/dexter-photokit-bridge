import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const root = new URL('../', import.meta.url);
const swift = fs.readFileSync(new URL('../ios/Plugin/DexterPhotoKitPlugin.swift', import.meta.url), 'utf8');
const definitions = fs.readFileSync(new URL('../dist/definitions.d.ts', import.meta.url), 'utf8');
const metadata = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expected = ['authorizationStatus', 'requestAuthorization', 'getAssetsPage', 'beginAssetScan', 'endAssetScan', 'listAlbums', 'createAlbum', 'isAlbumWritable', 'areAssetsAccessible', 'addExistingAssets', 'verifyAlbumMembership'];
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
  assert.doesNotMatch(swift, /PHImageManager|requestImage\s*\(|PHCachingImageManager|base64EncodedString/);
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
  assert.match(swift, /private let albumMutationQueue = DispatchQueue/);
  assert.match(swift, /private var albumMutationInFlight = false/);
  assert.match(swift, /"ALBUM_MUTATION_BUSY"/);
  assert.match(swift, /albumMutationQueue\\.sync[\\s\\S]*?albumMutationInFlight = true/);
  assert.match(swift, /private func releaseAlbumMutation\\(\\)[\\s\\S]*?albumMutationInFlight = false/);
  for (const body of [create, add]) {
    assert.match(body, /guard acquireAlbumMutation\\(call\\) else \\{ return \\}/);
    assert.match(body, /defer \\{ self\\.releaseAlbumMutation\\(\\) \\}/);
    assert.ok(body.indexOf('guard acquireAlbumMutation(call)') < body.indexOf('self.photoLibrary.performChanges('));
  }
  assert.match(create, /PHAssetCollection\\.fetchAssetCollections\\(/);
  assert.match(create, /options: \\[\\.caseInsensitive, \\.diacriticInsensitive\\]/);
  assert.match(create, /"ALBUM_ALREADY_EXISTS"/);
  assert.ok(create.indexOf('"ALBUM_ALREADY_EXISTS"') < create.indexOf('self.photoLibrary.performChanges('));
  assert.match(create, /self\\.releaseAlbumMutation\\(\\)\\s*call\\.reject\\("Já existe/);
  assert.match(add, /self\\.releaseAlbumMutation\\(\\)\\s*call\\.reject\\("Algumas fotografias/);
  assert.match(add, /if toAdd\\.isEmpty \\{\\s*self\\.releaseAlbumMutation\\(\\)/);
  assert.ok(add.indexOf('let presentAfter = self.membership') < add.indexOf('call.resolve([\\n                    "requestedCount"'));
});
