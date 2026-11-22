import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fixtureName, fixtureAppId, prepareFixture, verifyWiring } from '../scripts/local-pod-fixture.mjs';

function makeFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dexter-local-pod-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('package.json', { name: fixtureName, private: true, dependencies: { '@capacitor/core': '8.5.3', '@capacitor/app': '8.0.0' } });
  write('capacitor.config.json', { appId: fixtureAppId, webDir: 'www' });
  write('ios/App/App/capacitor.config.json', { appId: fixtureAppId, webDir: 'www',
    packageClassList: ['AppPlugin', 'ExistingFixturePlugin'], plugins: { App: { example: 'retain this nested value' } } });
  write('ios/App/App/public/index.html', '<html>preserve packaged web content</html>');
  write('ios/App/Podfile', "platform :ios, '15.0'\nuse_frameworks!\ndef capacitor_pods\n  pod 'CapacitorApp', :path => '../../node_modules/@capacitor/app'\nend\ntarget 'App' do\n  capacitor_pods\nend\n");
  write('ios/App/App.xcodeproj/project.pbxproj', 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;\nOTHER_FLAG = preserve;\n');
  write('vendor/dexter-photokit-bridge/package.json', { name: 'dexter-photokit-bridge', version: '0.1.0' });
  write('vendor/dexter-photokit-bridge/DexterPhotokitBridge.podspec',
    "s.name = 'DexterPhotokitBridge'\ns.ios.deployment_target = '15.5'\n");
  write('vendor/dexter-photokit-bridge/ios/Plugin/DexterPhotoKitPlugin.swift',
    '@objc(DexterPhotoKitPlugin)\nclass DexterPhotoKitPlugin: CAPPlugin, CAPBridgedPlugin { let jsName = "DexterPhotoKit" }\n');
  return { root, write, readJson: file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) };
}

test('local pod registration preserves existing plugins, settings, and packaged web bytes; repeat is idempotent', t => {
  const fixture = makeFixture(t);
  const before = fixture.readJson('ios/App/App/capacitor.config.json');
  prepareFixture(fixture.root);
  prepareFixture(fixture.root);
  const after = fixture.readJson('ios/App/App/capacitor.config.json');
  assert.deepEqual(after.packageClassList, ['AppPlugin', 'ExistingFixturePlugin', 'DexterPhotoKitPlugin']);
  assert.deepEqual(after.plugins, before.plugins);
  assert.deepEqual(verifyWiring(fixture.root).before.nativeConfig, before);
});

test('rejects a different app rather than patching an unseen Floot export', t => {
  const fixture = makeFixture(t);
  fixture.write('capacitor.config.json', { appId: 'app.floot.real-project', webDir: 'www' });
  assert.throws(() => prepareFixture(fixture.root), /Refusing to modify another app/);
});

for (const incorrect of ['DexterPhotoKit', 'DexterPhotokitBridge.DexterPhotoKitPlugin']) {
  test('rejects an unresolved native class string: ' + incorrect, t => {
    const fixture = makeFixture(t);
    prepareFixture(fixture.root);
    const config = fixture.readJson('ios/App/App/capacitor.config.json');
    config.packageClassList[2] = incorrect;
    fixture.write('ios/App/App/capacitor.config.json', config);
    assert.throws(() => verifyWiring(fixture.root), /Native settings or registrations changed/);
  });
}

test('detects dropped baseline registration and mutated nested native settings', t => {
  const fixture = makeFixture(t);
  prepareFixture(fixture.root);
  const config = fixture.readJson('ios/App/App/capacitor.config.json');
  config.packageClassList = ['DexterPhotoKitPlugin'];
  fixture.write('ios/App/App/capacitor.config.json', config);
  assert.throws(() => verifyWiring(fixture.root), /Native settings or registrations changed/);
  config.packageClassList = ['AppPlugin', 'ExistingFixturePlugin', 'DexterPhotoKitPlugin'];
  config.plugins.App.example = 'lost original setting';
  fixture.write('ios/App/App/capacitor.config.json', config);
  assert.throws(() => verifyWiring(fixture.root), /Native settings or registrations changed/);
});

test('rejects incorrect local pod path and overwritten web payload', t => {
  const fixture = makeFixture(t);
  prepareFixture(fixture.root);
  const podfile = fs.readFileSync(path.join(fixture.root, 'ios/App/Podfile'), 'utf8');
  fixture.write('ios/App/Podfile', podfile.replace('../../vendor/', '../vendor/'));
  assert.throws(() => verifyWiring(fixture.root), /Local pod path or existing Pods changed/);
  fixture.write('ios/App/Podfile', podfile);
  fixture.write('ios/App/App/public/index.html', 'accidental cap copy replacement');
  assert.throws(() => verifyWiring(fixture.root), /Packaged web assets changed/);
});

test('rejects accidentally npm-installed plugin and missing native vendor source', t => {
  const fixture = makeFixture(t);
  const metadata = fixture.readJson('package.json');
  metadata.dependencies['dexter-photokit-bridge'] = '0.1.0';
  fixture.write('package.json', metadata);
  assert.throws(() => prepareFixture(fixture.root), /Own plugin must not be npm-installed/);
  delete metadata.dependencies['dexter-photokit-bridge'];
  fixture.write('package.json', metadata);
  fs.rmSync(path.join(fixture.root, 'vendor/dexter-photokit-bridge/DexterPhotokitBridge.podspec'));
  assert.throws(() => prepareFixture(fixture.root), /ENOENT/);
});
