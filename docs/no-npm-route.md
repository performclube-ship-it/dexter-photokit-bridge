# DEXTER: native integration without publishing an npm package

Status recorded on 22 November 2026. This is a build route for the existing
Floot project `7f273ff5-3179-4961-b47b-f464cf562250`, not a second application.

## Decision

Use the original Floot mobile project export and include the existing PhotoKit
bridge as a **local CocoaPod**. No npm account, npm token, or publication of the
bridge is needed for this route. Public Capacitor build dependencies are still
downloaded from their registries.

Floot's managed build service still requires a public npm package, an exact
version, and an import from that package. A local pod does not circumvent that
service's restrictions: the exported native project is compiled separately.
Any native customization must be reapplied and reviewed after each new export.

## Evidence and limits

- The existing bridge passed Xcode 26.6 / CocoaPods 1.17.0 compilation and linking
  for iOS Simulator (arm64 and x86_64) in
  [run 45023974063](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45023974063).
- That run tested a locally packed tarball. Its SHA-256 is
  `12c440c58c0dec78ec9aea42284c9cceac608305808fe24de697695a4cfb5159`.
  The tarball has not been published to npm.
- The additional local-pod CI uses an isolated integration fixture. A successful
  unsigned iPhone SDK build proves compilation and linking through that route;
  it does not establish that the real DEXTER export builds, that permissions work,
  or that Photos operations work on an iPhone.
- The actual DEXTER native export has not yet been obtained or inspected. No
  signed build containing this bridge has been uploaded to TestFlight, and there
  is no evidence of a real-device pilot or public App Store approval.

## Obtain and inspect the original export

On the existing DEXTER project in Floot, open **Publish → Last build → Also from
this build → Project zip**. Use the existing successful build's download first;
do not request a new build merely to obtain a ZIP that is already available.
The user must provide this ZIP; the Floot connector does not expose its download.

Before modifying the export:

1. Verify the project identity and preserve bundle identifier
   `app.floot.u7f273ff531794961b47bf464cf562250`, app data/storage identity,
   entitlements, privacy manifests, permission strings and scene lifecycle.
2. Inspect its embedded web bundle. The latest native build completed at
   11:27 UTC on 22 November, before later PhotoKit UI and selection fixes. A
   successful web publish does not update the JavaScript embedded in that app.
   Stop if required bridge calls or safety fixes are missing; do not ship a stale
   bundle with newly enabled native capabilities.
3. Inspect the actual Podfile, Capacitor configuration and bridge registration.
   Apply the local pod and registration changes to this concrete layout; do not
   run the fixture preparation helper against an unreviewed export.
4. Keep full application exports and signing material out of this public plugin
   repository. Inspect for secrets before moving any app source to a CI system.

For the real Floot export, follow its lockfile and use **pnpm 10**, then
`pod install` in `ios/App`. **Do not run `cap sync` or `cap copy`**: the export
already contains the compiled web app and does not include the source `dist`
directory those commands expect. Open `App.xcworkspace`.

## Signing and real validation

An unsigned SDK build cannot be installed through TestFlight. Before uploading,
verify authorized Apple team access and a supported signing setup in the build
environment. Floot's Apple connection does not itself supply credentials to
GitHub Actions. Never copy passwords, private keys or access tokens into chat,
the repository, or the app's runtime configuration. Preserve the existing Apple
app identity and use an appropriate new build number.

Before public App Store review, still required: current web/native integration,
visible bounded photo previews, denied/limited/full permission tests, explicit
review of 3–10 non-sensitive existing PHAssets, membership verification by exact
album identifier, original-photo integrity checks, persistence/resume tests,
native library-change detection, measured 10,000+ processing on an actual
iPhone, privacy/accessibility review, and successful signed TestFlight testing.
iCloud synchronization between devices requires separate user confirmation and
cloud identifiers, not shared `PHAsset.localIdentifier` values.

## Alternative evaluated and rejected

`blix-photo-plugin@0.0.12` is already public and includes an `addToAlbum` operation
that associates existing assets. Its published source chooses the destination
by album title, silently skips missing IDs, and loads all destination album IDs.
A JavaScript wrapper cannot make its title-to-album choice atomic. It is not
installed in DEXTER; avoiding npm login must not weaken destination validation.

## Floot checkpoint status

On 22 November, the latest available publish status confirmed Pro and 11 of 12
monthly mobile builds remaining. Nine Jasmine spec files passed again. A new
typecheck request was refused because the account-wide 1,000 daily build-action
quota was exhausted; it resets at **23 November 2026, 09:00 UTC / Lisbon**.
No subsequent Floot code write, named checkpoint, web publish or native build
was attempted after that refusal. The last pilot-selection checkpoint remains
`8920c8a7-f4ee-46a3-bcd7-f5979c7f16d8`; the changed files had passed typecheck in
the preceding execution. Do not report the refused typecheck as a pass.

The code and native CI work for this alternative are checkpointed in this
existing GitHub repository. Transfer this status into the original Floot
`static/__dev/photokit-bridge.md` once the daily limit has actually cleared.

## Primary sources

- [Floot: native plugins and native settings](https://floot.com/docs/mobile-apps/native-plugins)
- [Floot: installing your iOS app](https://floot.com/docs/mobile-apps/installing-ios-app)
- [Floot: creating mobile apps](https://floot.com/docs/mobile-apps/creating-mobile-apps-in-floot)
- [Capacitor 8: custom native code](https://capacitorjs.com/docs/ios/custom-code)

