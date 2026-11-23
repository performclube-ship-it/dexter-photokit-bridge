import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const swift = fs.readFileSync(new URL('../ios/Plugin/DexterPhotoKitPlugin.swift', import.meta.url), 'utf8');
const types = fs.readFileSync(new URL('../dist/definitions.d.ts', import.meta.url), 'utf8');
const classify = swift.split('@objc func classifyPilotAssets(_ call: CAPPluginCall) {')[1]
  ?.split('@objc func addExistingAssets(_ call: CAPPluginCall) {')[0];

test('local Vision classification is opt-in, typed and hard limited before pixels', () => {
  assert.match(swift, /import Vision/);
  assert.match(swift, /CAPPluginMethod\(name: "classifyPilotAssets"/);
  assert.match(types, /classifyPilotAssets\(input: \{ assetIds: string\[\] \}\)/);
  assert.ok(classify);
  assert.match(classify, /guard hasFullAccess\(call\) else \{ return \}/);
  assert.match(classify, /guard let ids = assetIds\(call\) else \{ return \}/);
  assert.match(classify, /guard ids.count <= maxPilotWrite else \{/);
  assert.ok(classify.indexOf('guard ids.count <= maxPilotWrite') < classify.indexOf('PHImageManager.default()'));
  assert.match(classify, /guard acquirePilotPreview\(call\) else \{ return \}/);
  assert.match(classify, /defer \{ self.releasePilotPreview\(\) \}/);
});

test('classification is local, bounded, sequential and cannot download cloud originals', () => {
  assert.match(classify, /options\.isNetworkAccessAllowed = false/);
  assert.match(classify, /options\.isSynchronous = true/);
  assert.match(classify, /CGSize\(width: 224, height: 224\)/);
  assert.match(classify, /preparingThumbnail\(of: target\)/);
  assert.match(classify, /VNClassifyImageRequest\(\)/);
  assert.match(classify, /VNImageRequestHandler\(cgImage: pixels/);
  assert.match(classify, /\.prefix\(3\)/);
  assert.match(classify, /"icloud" : "unavailable"/);
  assert.match(classify, /asset\.mediaType == \.image/);
  assert.doesNotMatch(classify, /isNetworkAccessAllowed = true|URLSession|uploadTask|UserDefaults|FileManager|print\(|requestImageData|PHImageManagerMaximumSize|performChanges|addAssets|creationRequestForAsset/);
  assert.doesNotMatch(classify, /dataUrl|base64EncodedString/);
});

test('classification cannot be invoked by metadata pagination and types match distribution', () => {
  assert.equal(fs.readFileSync(new URL('../src/definitions.ts', import.meta.url), 'utf8'), types);
  const paging = swift.split('@objc func getAssetsPage(_ call: CAPPluginCall) {')[1]
    .split('@objc func listAlbums(_ call: CAPPluginCall) {')[0];
  assert.doesNotMatch(paging, /VNClassify|VNImageRequest|PHImageManager|requestImage/);
  assert.match(classify, /call.resolve\(\["results": results\]\)/);
});
