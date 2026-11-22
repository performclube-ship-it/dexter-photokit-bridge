# DEXTER PhotoKit bridge — UNPUBLISHED candidate v0.1.0

Capacitor 8 Swift PhotoKit plugin for the **existing** DEXTER Floot project
`7f273ff5-3179-4961-b47b-f464cf562250`.

## Security & scope

- Does **not** copy, move, edit or delete original photos; no photo pixel data leaves native PhotoKit in this plugin.
- Photo metadata paging (`getAssetsPage`) uses native `PHAsset.fetchAssets` and returns at most 250 metadata records per call; **not** image/base64 data.
- The only Photos writes are `PHAssetCollectionChangeRequest.creationRequestForAssetCollection` (new empty album on explicit user action) and `PHAssetCollectionChangeRequest.addAssets` (association of **existing** assets to a regular Apple album). Never uses `PHAssetChangeRequest`, `PHAssetCreationRequest`, `PHAssetCollectionChangeRequest.removeAssets` or `PHPhotoLibrary.delete`.
- Requires full Photos read/write consent; rejects limited access. UI in Floot supplies an additional explicit confirmation for the pilot of 3–10 existing photos.
- Existing PHAsset identifiers are device-specific; **not** an iCloud synchronization contract.

## Integration (only after GitHub macOS Xcode CI succeeds and package is published to npm)

1. Run `npm test`, `npm run verify`, `npm pack --dry-run` and macOS Xcode build. Confirm npm package is public at the exact chosen version.
2. On Floot **original project**, install **exact** `dexter-photokit-bridge@0.1.0` with `add_dependency`.
3. In `helpers/dexterAppleAlbums.tsx`, change:
   `import { Capacitor, registerPlugin } from '@capacitor/core'` to `import { Capacitor } from '@capacitor/core'; import { DexterPhotoKit as photoKit } from 'dexter-photokit-bridge'`, remove the `registerPlugin(...)` line, keep its `DexterPhotoKitNative` TS interface and bridge guard.
4. Keep iOS `NSPhotoLibraryUsageDescription` and add `NSPhotoLibraryAddUsageDescription` only if needed; ensure permissions describe the actual access. Run Floot typecheck and Jasmine tests.
5. **Only then** build iOS with Floot; test TestFlight on an iPhone with 3–10 non-sensitive existing assets. Validate permission denial and limited Photos permission; check physical Photos app and iCloud behavior. Check 100, 1,000, then 10,000+ with device memory monitoring before claiming performance.

## macOS cloud CI

`.github/workflows/native-ci.yml` builds a disposable Capacitor 8 iOS sample app that imports the **locally packed npm tarball** using CocoaPods and runs `xcodebuild` against iOS Simulator. It is only a **plugin validation fixture**, not another Floot app. It does not sign, upload or submit DEXTER to Apple.

The script explicitly selects CocoaPods because Capacitor 8 otherwise defaults to SPM. It creates the base fixture before installing the plugin and sets both its Podfile and Xcode deployment target to iOS 15.5 before synchronizing the plugin. This avoids a 15.0/15.5 pod-resolution conflict. Static checks do not establish that this Xcode build passes; macOS CI and real-device testing are still required.

## Publication

`npm publish --access public` **requires** an authorized npm account. Never share credentials in chat. Configure trusted publishing after first publication if supported. The package is not ready for consumers until Xcode CI passes.
