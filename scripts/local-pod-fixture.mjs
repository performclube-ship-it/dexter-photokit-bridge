// Deliberately restricted to our disposable CI fixture. Not a Floot ZIP patcher.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const fixtureName = 'dexter-local-pod-ci-fixture';
export const fixtureAppId = 'com.dexter.ci.localpod';
export const pluginClass = 'DexterPhotoKitPlugin';
export const podName = 'DexterPhotokitBridge';
export const vendorRelative = 'vendor/dexter-photokit-bridge';
export const podRelative = '../../' + vendorRelative;
const baselineName = '.dexter-local-pod-before.json';
const nativeConfigPath = 'ios/App/App/capacitor.config.json';
const podLine = "  pod 'DexterPhotokitBridge', :path => '../../vendor/dexter-photokit-bridge'";
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (root, file) => JSON.parse(read(root, file));
const writeJson = (root, file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');

function requireFixture(root) {
  const metadata = json(root, 'package.json');
  assert.equal(metadata.name, fixtureName, 'Only the disposable local-pod fixture is supported');
  assert.equal(metadata.private, true, 'Fixture must be private');
  const config = json(root, 'capacitor.config.json');
  assert.equal(config.appId, fixtureAppId, 'Refusing to modify another app');
  assert.equal(config.webDir, 'www');
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.equal(metadata[section]?.['dexter-photokit-bridge'], undefined, 'Own plugin must not be npm-installed');
  }
  assert.equal(fs.existsSync(path.join(root, 'node_modules/dexter-photokit-bridge')), false,
    'Own plugin must not be present in node_modules');
}

function fileManifest(root) {
  assert.ok(fs.statSync(root).isDirectory(), 'Packaged web assets must exist');
  const output = {};
  function visit(directory, prefix) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? prefix + '/' + entry.name : entry.name;
      const absolute = path.join(directory, entry.name);
      assert.equal(entry.isSymbolicLink(), false, 'Unexpected symlink in packaged web assets');
      if (entry.isDirectory()) visit(absolute, relative);
      else if (entry.isFile()) output[relative] = hash(fs.readFileSync(absolute));
    }
  }
  visit(root, '');
  assert.ok(Object.keys(output).length > 0, 'Packaged web assets must not be empty');
  return output;
}

function expectedRegistration(before) {
  assert.ok(Array.isArray(before.packageClassList), 'Capacitor 8.5.3 registration list is missing');
  assert.ok(before.packageClassList.every(item => typeof item === 'string'));
  assert.ok(before.packageClassList.includes('AppPlugin'), 'Baseline official App plugin must remain registered');
  assert.equal(new Set(before.packageClassList).size, before.packageClassList.length, 'Duplicate baseline class');
  return { ...before, packageClassList: [...before.packageClassList.filter(item => item !== pluginClass), pluginClass] };
}

function expectedPodfile(before) {
  assert.equal((before.match(/platform\s+:ios,\s*'[^']+'/g) || []).length, 1, 'Unexpected fixture Podfile platform');
  assert.equal((before.match(/^target 'App' do$/gm) || []).length, 1, 'Unexpected fixture App target');
  assert.equal(before.includes(podName), false, 'Local pod was already wired without a baseline');
  return before.replace(/platform\s+:ios,\s*'[^']+'/, "platform :ios, '15.5'")
    .replace(/^target 'App' do$/m, "target 'App' do\n" + podLine);
}

function expectedProject(before) {
  assert.ok(/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;/.test(before), 'Missing deployment target');
  return before.replace(/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 15.5;');
}

function checkVendor(root) {
  const vendor = path.join(root, vendorRelative);
  const resolvedPod = path.resolve(root, 'ios/App', podRelative);
  assert.equal(fs.realpathSync(resolvedPod), fs.realpathSync(vendor), 'Pod path must resolve to the vendored package');
  const metadata = json(vendor, 'package.json');
  assert.equal(metadata.name, 'dexter-photokit-bridge');
  assert.equal(metadata.version, '0.1.0');
  const podspec = read(vendor, podName + '.podspec');
  assert.match(podspec, /s\.name = 'DexterPhotokitBridge'/);
  assert.match(podspec, /s\.ios\.deployment_target = '15\.5'/);
  const swift = read(vendor, 'ios/Plugin/DexterPhotoKitPlugin.swift');
  assert.match(swift, /@objc\(DexterPhotoKitPlugin\)/);
  assert.match(swift, /CAPPlugin,\s*CAPBridgedPlugin/);
  assert.match(swift, /jsName = "DexterPhotoKit"/);
  return { podspecSha256: hash(podspec), swiftSha256: hash(swift) };
}

export function prepareFixture(root) {
  requireFixture(root);
  checkVendor(root);
  const baselineFile = path.join(root, baselineName);
  if (fs.existsSync(baselineFile)) return verifyWiring(root);
  const before = {
    nativeConfig: json(root, nativeConfigPath),
    rootConfigSha256: hash(read(root, 'capacitor.config.json')),
    web: fileManifest(path.join(root, 'ios/App/App/public')),
    podfile: read(root, 'ios/App/Podfile'),
    project: read(root, 'ios/App/App.xcodeproj/project.pbxproj'),
  };
  const nextConfig = expectedRegistration(before.nativeConfig);
  const nextPodfile = expectedPodfile(before.podfile);
  const nextProject = expectedProject(before.project);
  writeJson(root, baselineName, before);
  writeJson(root, nativeConfigPath, nextConfig);
  fs.writeFileSync(path.join(root, 'ios/App/Podfile'), nextPodfile);
  fs.writeFileSync(path.join(root, 'ios/App/App.xcodeproj/project.pbxproj'), nextProject);
  return verifyWiring(root);
}

export function verifyWiring(root) {
  requireFixture(root);
  const vendor = checkVendor(root);
  const before = json(root, baselineName);
  const expectedConfig = expectedRegistration(before.nativeConfig);
  assert.deepEqual(json(root, nativeConfigPath), expectedConfig, 'Native settings or registrations changed');
  assert.equal(hash(read(root, 'capacitor.config.json')), before.rootConfigSha256, 'Root config changed');
  assert.deepEqual(fileManifest(path.join(root, 'ios/App/App/public')), before.web, 'Packaged web assets changed');
  assert.equal(read(root, 'ios/App/Podfile'), expectedPodfile(before.podfile), 'Local pod path or existing Pods changed');
  assert.equal(read(root, 'ios/App/App.xcodeproj/project.pbxproj'), expectedProject(before.project), 'Unexpected Xcode project change');
  return { before, expectedConfig, vendor };
}

export function verifyPodInstall(root) {
  const result = verifyWiring(root);
  const localSpec = json(root, 'ios/App/Pods/Local Podspecs/' + podName + '.podspec.json');
  assert.equal(localSpec.name, podName);
  assert.equal(localSpec.version, '0.1.0');
  assert.match(read(root, 'ios/App/Podfile.lock'), /DexterPhotokitBridge \(0\.1\.0\)/);
  assert.ok(read(root, 'ios/App/Podfile.lock').includes(podRelative), 'Lockfile must record the local vendor path');
  assert.ok(read(root, 'ios/App/Pods/Pods.xcodeproj/project.pbxproj').includes('DexterPhotoKitPlugin.swift'),
    'Swift implementation must be in the generated Pods build project');
  return result;
}

export function verifyBuiltFixture(root, artifactDirectory) {
  const { before, expectedConfig, vendor } = verifyPodInstall(root);
  const app = path.join(root, 'DerivedData/Build/Products/Debug-iphoneos/App.app');
  assert.deepEqual(json(app, 'capacitor.config.json'), expectedConfig, 'Built app lost native config/registration');
  assert.deepEqual(fileManifest(path.join(app, 'public')), before.web, 'Built web payload differs from the preserved payload');
  const framework = path.join(app, 'Frameworks', podName + '.framework', podName);
  assert.ok(fs.statSync(framework).size > 0, 'Plugin framework must be embedded in the app');
  const symbols = execFileSync('xcrun', ['nm', '-gU', framework], { encoding: 'utf8' });
  assert.ok(symbols.includes('_OBJC_CLASS_$_DexterPhotoKitPlugin'), 'Native Objective-C class is absent from the binary');
  const architectures = execFileSync('xcrun', ['lipo', '-archs', framework], { encoding: 'utf8' }).trim();
  assert.ok(architectures.split(/\s+/).includes('arm64'), 'Expected iPhone arm64 code');
  // Xcode may place application linkage in App.debug.dylib.
  const executableNames = ['App', 'App.debug.dylib'].filter(name => fs.existsSync(path.join(app, name)));
  const links = Object.fromEntries(executableNames.map(name =>
    [name, execFileSync('xcrun', ['otool', '-L', path.join(app, name)], { encoding: 'utf8' })]));
  assert.ok(Object.values(links).some(text => text.includes('/' + podName + '.framework/' + podName)),
    'App executable must link the plugin framework so NSClassFromString can resolve it');
  const evidence = {
    schemaVersion: 1,
    status: 'verified',
    fixtureOnly: true,
    realDexterExport: false,
    signed: false,
    uploaded: false,
    executedOnDevice: false,
    photoKitBehaviorTested: false,
    fixtureAppId,
    capacitorVersion: '8.5.3',
    sdk: 'iphoneos',
    architectures,
    xcode: execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).trim(),
    registration: { mechanism: 'Capacitor 8.5.3 packageClassList', className: pluginClass,
      before: before.nativeConfig.packageClassList, after: expectedConfig.packageClassList },
    pod: { name: podName, path: podRelative, ...vendor },
    packageSha256: hash(fs.readFileSync(path.join(root, 'dexter-photokit-bridge-0.1.0.tgz'))),
    frameworkSha256: hash(fs.readFileSync(framework)),
    webPayload: { unchanged: true, files: before.web },
    checks: { ownPluginNotNpmInstalled: true, localPodResolved: true, swiftIncludedInPods: true,
      embeddedFramework: true, objectiveCClassPresent: true, applicationLinkedFramework: true },
    limitations: ['Disposable fixture only; original Floot project ZIP not examined.',
      'Compile/link/configuration evidence only; no runtime bridge calls or iPhone PhotoKit validation.',
      'Apple signing, TestFlight upload and App Store review are separate unperformed steps.'],
  };
  fs.mkdirSync(artifactDirectory, { recursive: true });
  writeJson(artifactDirectory, 'local-pod-evidence.json', evidence);
  fs.writeFileSync(path.join(artifactDirectory, 'linked-frameworks.txt'), JSON.stringify(links, null, 2) + '\n');
  fs.writeFileSync(path.join(artifactDirectory, 'plugin-symbols.txt'), symbols);
  writeJson(artifactDirectory, 'native-config-before.json', before.nativeConfig);
  writeJson(artifactDirectory, 'native-config-after.json', expectedConfig);
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [operation, fixtureRoot, artifactDirectory] = process.argv.slice(2);
  assert.ok(fixtureRoot, 'A disposable fixture path is required');
  if (operation === 'prepare') prepareFixture(path.resolve(fixtureRoot));
  else if (operation === 'verify') verifyWiring(path.resolve(fixtureRoot));
  else if (operation === 'verify-pods') verifyPodInstall(path.resolve(fixtureRoot));
  else if (operation === 'verify-built') {
    assert.ok(artifactDirectory, 'Artifact directory is required');
    verifyBuiltFixture(path.resolve(fixtureRoot), path.resolve(artifactDirectory));
  } else throw new Error('Unknown local-pod fixture operation');
  console.log('Local-pod fixture ' + operation + ': OK');
}
