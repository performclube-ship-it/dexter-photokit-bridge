import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const swift = fs.readFileSync(new URL('../ios/Plugin/DexterPhotoKitPlugin.swift', import.meta.url), 'utf8');
const declarations = fs.readFileSync(new URL('../dist/definitions.d.ts', import.meta.url), 'utf8');
const preview = swift.split('@objc func getPilotPreviews(_ call: CAPPluginCall) {')[1]
  .split('@objc func addExistingAssets(_ call: CAPPluginCall) {')[0];
test('pilot previews require explicit full permission and reject more than ten before reading pixels', () => {
  assert.match(swift, /CAPPluginMethod\(name: "getPilotPreviews"/);
  assert.match(declarations, /getPilotPreviews\(input: \{ assetIds: string\[\] \}\)/);
  assert.match(preview, /guard hasFullAccess\(call\) else \{ return \}/);
  assert.match(preview, /guard let ids = assetIds\(call\) else \{ return \}/);
  assert.match(preview, /guard ids\.count <= maxPilotWrite else \{/);
  assert.ok(preview.indexOf('guard ids.count <= maxPilotWrite') < preview.indexOf('PHImageManager.default()'));
  assert.match(preview, /guard acquirePilotPreview\(call\) else \{ return \}/);
  assert.match(preview, /defer \{ self\.releasePilotPreview\(\) \}/);
});
test('no iCloud image download, only 128px output, capped JPEG payload and explicit cloud status', () => {
  assert.match(preview, /options\.isNetworkAccessAllowed = false/);
  assert.match(preview, /options\.isSynchronous = true/);
  assert.match(preview, /CGSize\(width: 128, height: 128\)/);
  assert.match(preview, /image\.preparingThumbnail\(of: target\)/);
  assert.match(preview, /jpeg\.count <= 65536/);
  assert.match(preview, /PHImageResultIsInCloudKey/);
  assert.match(preview, /requiresCloud \? "icloud" : "unavailable"/);
  assert.doesNotMatch(preview, /PHImageManagerMaximumSize|isNetworkAccessAllowed = true|creationRequestForAsset/);
});
test('only the preview API reads pixels; metadata pagination stays pixel-free', () => {
  const paging = swift.split('@objc func getAssetsPage(_ call: CAPPluginCall) {')[1]
    .split('@objc func listAlbums(_ call: CAPPluginCall) {')[0];
  assert.doesNotMatch(paging, /PHImageManager|requestImage|UIImage|base64EncodedString/);
  assert.doesNotMatch(preview, /URLSession|uploadTask|UserDefaults|FileManager|print\(/);
  assert.match(preview, /data:image\/jpeg;base64,/);
});
