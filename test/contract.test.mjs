import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const root = new URL('../', import.meta.url);
const swift = fs.readFileSync(new URL('../ios/Plugin/DexterPhotoKitPlugin.swift', import.meta.url), 'utf8');
const definitions = fs.readFileSync(new URL('../dist/definitions.d.ts', import.meta.url), 'utf8');
const metadata = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expected = ['authorizationStatus', 'requestAuthorization', 'getAssetsPage', 'listAlbums', 'createAlbum', 'isAlbumWritable', 'areAssetsAccessible', 'addExistingAssets', 'verifyAlbumMembership'];
test('all nine native methods match JS bridge', () => {
  for (const name of expected) {
    assert.match(swift, new RegExp('CAPPluginMethod\\(name: "'+name+'"'));
    assert.match(swift, new RegExp('\\@objc func '+name+'\\('));
    assert.match(definitions, new RegExp(name+'\\('));
  }
});
test('Capacitor version, CocoaPods and deployment target', () => {
  assert.equal(metadata.peerDependencies['@capacitor/core'], '^8.0.0');
  const podspec = fs.readFileSync(new URL('../DexterPhotoKit.podspec', import.meta.url), 'utf8');
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
  assert.match(swift, /PHAsset\.fetchAssets\(with: options\)/);
  assert.doesNotMatch(swift, /PHImageManager|requestImage\s*\(|PHCachingImageManager|base64EncodedString/);
  assert.match(swift, /limit <= maxPage/);
});
test('native module uses JS export and only carries iOS assets in package', () => {
  const js = fs.readFileSync(new URL('../dist/index.js', import.meta.url), 'utf8');
  assert.match(js, /registerPlugin\('DexterPhotoKit'\)/);
  assert.ok(metadata.files.includes('ios/'));
  assert.ok(metadata.files.includes('DexterPhotoKit.podspec'));
});
