#!/usr/bin/env bash
set -euo pipefail
# Build a disposable iOS Capacitor fixture from the local package; never build or upload real DEXTER.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURE="$(mktemp -d)"
trap 'rm -rf "$FIXTURE"' EXIT
cd "$FIXTURE"
cat > package.json <<'JSON'
{"name":"dexter-ios-ci-fixture","version":"0.0.1","private":true,"type":"module"}
JSON
npm install --no-audit --no-fund --save-exact @capacitor/core@8.5.3 @capacitor/cli@8.5.3 @capacitor/ios@8.5.3
mkdir -p www
echo '<!doctype html><html><head><meta charset="utf-8"></head><body>DEXTER native plugin CI fixture</body></html>' > www/index.html
cat > capacitor.config.json <<'JSON'
{"appId":"com.dexter.ci.smoke","appName":"DexterPhotoKit Smoke","webDir":"www"}
JSON
# Capacitor 8 defaults to SPM; this plugin is distributed with a CocoaPods podspec.
# Create the fixture before installing the plugin: cap add also resolves pods,
# and its initial target (15.0) is lower than the bridge's target (15.5).
npx cap add ios --packagemanager CocoaPods
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const edits = [
  ['ios/App/Podfile', /platform\s+:ios,\s*'[^']+'/g, "platform :ios, '15.5'"],
  ['ios/App/App.xcodeproj/project.pbxproj', /IPHONEOS_DEPLOYMENT_TARGET = [0-9.]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 15.5;'],
];
for (const [path, pattern, replacement] of edits) {
  const source = readFileSync(path, 'utf8');
  if (!pattern.test(source)) throw new Error(`No deployment target found in ${path}`);
  pattern.lastIndex = 0;
  writeFileSync(path, source.replace(pattern, replacement));
}
JS
# Test exactly what npm will ship, rather than a symlink to the development tree.
(cd "$ROOT" && npm pack --ignore-scripts --pack-destination "$FIXTURE" >/dev/null)
npm install --no-audit --no-fund "$FIXTURE/dexter-photokit-bridge-0.1.0.tgz"
npx cap sync ios
# Proof: the generated Pods config must include this exact local plugin, not an npm placeholder.
grep -R -q 'DexterPhotoKit' ios/App/Podfile ios/App/Podfile.lock ios/App/Pods/Local\ Podspecs 2>/dev/null || {
  echo 'ERROR: plugin missing from CocoaPods installation' >&2; exit 1;
}
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath "$FIXTURE/DerivedData" CODE_SIGNING_ALLOWED=NO build
