#!/usr/bin/env bash
set -euo pipefail
# Standalone fixture proof: no npm publication/install of our plugin, signing or upload.
# This script does not accept or modify a real Floot export.
DEXTER_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for DEXTER_TOOL in node npm pod xcodebuild xcrun tar; do
  command -v "$DEXTER_TOOL" >/dev/null || { echo "Required macOS tool is missing: $DEXTER_TOOL" >&2; exit 1; }
done
DEXTER_FIXTURE="$(mktemp -d)"
DEXTER_ARTIFACTS="$DEXTER_ROOT/ci-artifacts/local-pod"
mkdir -p "$DEXTER_ARTIFACTS"
printf '{"status":"running","fixtureOnly":true}\n' > "$DEXTER_ARTIFACTS/build-status.json"
cleanup() {
  DEXTER_EXIT="$?"
  if [ -f "$DEXTER_FIXTURE/xcodebuild.log" ]; then
    cp "$DEXTER_FIXTURE/xcodebuild.log" "$DEXTER_ARTIFACTS/xcodebuild.log"
  fi
  if [ "$DEXTER_EXIT" -ne 0 ]; then
    printf '{"status":"failed","fixtureOnly":true,"exitCode":%s}\n' "$DEXTER_EXIT" > "$DEXTER_ARTIFACTS/build-status.json"
  fi
  rm -rf "$DEXTER_FIXTURE"
}
trap cleanup EXIT
cd "$DEXTER_FIXTURE"
cat > package.json <<'JSON'
{"name":"dexter-local-pod-ci-fixture","version":"0.0.1","private":true,"type":"module"}
JSON
# The official App plugin gives the baseline a real pre-existing registration to preserve.
npm install --ignore-scripts --no-audit --no-fund --save-exact @capacitor/core@8.5.3 @capacitor/cli@8.5.3 @capacitor/ios@8.5.3 @capacitor/app@8.0.0
mkdir -p www
printf '<!doctype html><html><head><meta charset="utf-8"></head><body>Local pod CI fixture; no personal photos</body></html>\n' > www/index.html
cat > capacitor.config.json <<'JSON'
{"appId":"com.dexter.ci.localpod","appName":"DEXTER Local Pod Fixture","webDir":"www","plugins":{"App":{"disableBackButtonHandler":false}}}
JSON
# cap add may copy/sync its initial template. All manual native wiring happens AFTER it.
./node_modules/.bin/cap add ios --packagemanager CocoaPods
(cd "$DEXTER_ROOT" && npm pack --ignore-scripts --pack-destination "$DEXTER_FIXTURE" >/dev/null)
mkdir -p vendor/dexter-photokit-bridge
tar -xzf dexter-photokit-bridge-0.1.0.tgz -C vendor/dexter-photokit-bridge --strip-components=1

# No cap sync/copy after this point: preserve the already packaged web app and native config.
node "$DEXTER_ROOT/scripts/local-pod-fixture.mjs" prepare "$DEXTER_FIXTURE"
(cd ios/App && pod install)
node "$DEXTER_ROOT/scripts/local-pod-fixture.mjs" verify-pods "$DEXTER_FIXTURE"
echo 'Building an unsigned iPhone arm64 fixture with the vendored local pod...'
if ! xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath "$DEXTER_FIXTURE/DerivedData" \
  CODE_SIGNING_ALLOWED=NO build > "$DEXTER_FIXTURE/xcodebuild.log" 2>&1; then
  tail -n 120 "$DEXTER_FIXTURE/xcodebuild.log" >&2
  exit 1
fi
node "$DEXTER_ROOT/scripts/local-pod-fixture.mjs" verify-built "$DEXTER_FIXTURE" "$DEXTER_ARTIFACTS"
cp dexter-photokit-bridge-0.1.0.tgz "$DEXTER_ARTIFACTS/"
printf '{"status":"verified","fixtureOnly":true,"sdk":"iphoneos","signed":false,"executedOnDevice":false}\n' > "$DEXTER_ARTIFACTS/build-status.json"
echo 'Unsigned iPhone compilation, linkage and registration data verified. No device test or upload performed.'
