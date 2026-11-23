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
- **The local-pod route passed**
  [run 45028061579](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45028061579),
  job `137225313413`, at 13:35 UTC on 22 November. Xcode 26.6 compiled the
  unchanged bridge for the **iPhone SDK / arm64**, without code signing. Seven
  new Node tests passed in that run. Checks confirmed the local pod, embedded
  framework, exported Objective-C class, app linkage, preserved plugin
  registrations, and byte-identical embedded web files. The own plugin was not
  installed through npm or published. The tested package matches the SHA-256
  above and the previously tested source files.
- [Verified evidence](evidence/local-pod-2026-11-22.json) is retained in this
  repository, with run/commit/artifact provenance. The downloaded artifact ZIP's
  SHA-256 was verified against GitHub metadata before reading its contents.
- This proof uses an isolated integration fixture. It does not establish that
  the real DEXTER export builds, that permissions work, or that Photos operations
  work on an iPhone.
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


## Read-only original export preflight (22 November 2026)

The repository now contains `scripts/inspect-floot-export.mjs`, a **read-only**
validator for an extracted original Floot native Project zip. Run it locally
with `node scripts/inspect-floot-export.mjs /path/to/extracted/export` after
obtaining the user's file privately. It verifies both Capacitor app identities,
checks core iOS/CocoaPods files, examines the already-embedded web bundle for
native bridge and bulk-selection guard markers, computes source fingerprints,
and flags possible signing files without exposing their content. A `BLOCKED`
result must stop native integration; `REVIEW_REQUIRED` still requires a human
review of actual export structure, the build date, app identity, signing,
privacy/entitlements and photo-safety semantics. Marker detection is only a
stale-bundle screening heuristic, not proof that all safety fixes are present.
The inspector makes no filesystem changes and never uploads the export.
Run `node --test test/export-inspector.test.mjs` for positive, stale-bundle,
identity, missing-plist, secret and symlink regression cases. No native export
had been supplied when this guard was written.


## Native export safety hardening (22 November 2026, 14:40 UTC)

Before adding the local PhotoKit bridge, the read-only original-export inspector
also requires the existing Xcode `PRODUCT_BUNDLE_IDENTIFIER` to agree with the
DEXTER bundle ID in BOTH Capacitor configurations. An absent or mixed Xcode
identity blocks the procedure. It also blocks a missing/blank readable
`NSPhotoLibraryUsageDescription` and refuses symlinks in any ancestor of native
files or the packaged web directory, not just symlinks in the last path
component. This prevents following a substituted `ios/App` or `public`
directory outside the extracted export.

**Evidence:** the existing [read-only export preflight CI run
45034074140](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45034074140)
passed all **11 Node regression tests** after the safety fixes. Tests use
disposable mock exports, not the actual mobile build. The verdict
`REVIEW_REQUIRED` is never approval to ship, and `BLOCKED` always prevents
native integration. No Apple Photos originals were accessed or changed.

These checks deliberately cannot guarantee that a specific Xcode configuration
will sign with the expected app identity or that a compiled JavaScript marker
corresponds to an active code path. Review the real downloaded ZIP, resolve all
warnings and perform an actual unsigned Xcode build and device tests before
considering signing or TestFlight. The original Floot export is still missing.


## 22 Nov 2026 — opt-in native photo-library snapshot contract

The plugin now exposes **beginAssetScan / getAssetsPage(snapshotToken) / endAssetScan**.
The native plugin retains one lazy `PHFetchResult<PHAsset>` in memory under an
opaque per-process token. The Photos change observer invalidates that session
conservatively on any photo-library change, even where total asset counts are
unchanged. Page calls with an expired token fail closed rather than refetching
a different order. Starting a new session deliberately replaces the old
snapshot and old tokens cease to work. Returning a page also rechecks that its
session was not invalidated during enumeration.

**Important:** token-less calls remain backward compatible and DO NOT gain
snapshot consistency. Floot's existing app must adopt begin/token/end before
claiming stable pagination of 10,000+ images. Across app restarts, tokens expire
by design; the UI must revalidate previous locally saved progress and start a
new session rather than assuming the same native snapshot survived. The new snapshot API passed unsigned Xcode/CocoaPods compilation for both the
iPhone SDK (arm64) and iOS Simulator on 22 November 2026; this does **not**
constitute a real device test, an atomic PhotoKit transaction, or validation
of 10,000+ real photographs. The old successful tarball's SHA256 documented
above is historical: it precedes these changes and MUST NOT be used as
evidence for this updated Swift source.

### Snapshot CI evidence (22 November 2026, 15:40 UTC)

- [iPhone SDK local CocoaPod run 45039471307](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45039471307):
  **success**; static verification, native Swift build, arm64 framework and
  Objective-C registration/linkage checks. Artifact 14761350656, outer ZIP
  digest SHA256 `111f8c11f4ac07b5f9cdf6b620c50cf5dd37027626e144e08f262a07c43b24e4`.
- [iOS Simulator/CocoaPods run 45039471340](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45039471340):
  **success**; contract tests, type/interface checks performed by project scripts,
  Swift compilation and packaging. Artifact 14760739045, outer ZIP digest
  SHA256 `bc1ddd834b287b48fca172c5093e3ec1a14ff36b208bdb878f978bc23ea728dd`.
- Both runs tested source commit
  `46c8ebbb58849c19ccf952f05c295e9ac88f3aa8`, merged into main via
  [PR #2](https://github.com/performclube-ship-it/dexter-photokit-bridge/pull/2)
  at merge commit `34f119e985d2223b03c8156a7ebc4c437fd47bee`.

**Still not done:** Floot UI code does not pass snapshotToken; its calls use
legacy unsnapshotted pages. The native package has not been installed in an
actual DEXTER export or uploaded as a signed TestFlight build. Obtain the
original private Project ZIP, inspect embedded web bundle/version, integrate
the current bridge and adopt token-based pages with explicit reset/expiry
handling before testing 10,000+ photos on a physical iPhone.


## 22 November 2026 — native album-write race hardening (unsigned CI passed)

The bridge now reserves a single album mutation at a time within its own iOS
plugin instance. Concurrent create/add requests fail explicitly with
`ALBUM_MUTATION_BUSY`, preventing two app requests from reading the same stale
membership and reporting conflicting counts. Native album creation checks for
an existing regular album with a case/diacritic-insensitive matching title
before calling PhotoKit; retries fail with `ALBUM_ALREADY_EXISTS` instead of
silently creating a duplicate. The lock is released on every early rejection,
no-op and PhotoKit completion, including failed verification. The guard does
not prevent other apps or another device from changing the Photos library;
exact album IDs and post-operation membership checks remain mandatory.
This is not a device test and does not change the built DEXTER app.


## 22 November 2026, 18:40 UTC — native pilot safety gate merged

The **iOS Swift** `addExistingAssets` endpoint now refuses selections larger
than **10 PHAssets per native call** with `PILOT_WRITE_LIMIT`, even if JavaScript
or the preview UI is bypassed. This refusal occurs *before* the mutation lock
or PhotoKit write. Metadata/accessibility/verification batch reads retain their
250-ID limit. This is a per-call guard, **not** a lifetime or session quota.

For an all-already-present selection, the native no-op branch now performs a
second membership query before claiming success. If the album changed between
reads, it returns `ALBUM_NOOP_UNVERIFIED` instead of falsely reporting ten
confirmed items. The bridge still verifies all requested members after an
actual PhotoKit mutation. No originals are copied, removed or deleted.

**Validated:** commit `824d6041cbee1d43c5d6fbe7d354db0572fccfb9` passed the
[unsigned iPhone arm64 local-pod CI](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45056315958)
and [iOS Simulator/CocoaPods CI](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45056315975),
including new regression checks for both guards. Merged to `main` through
[PR #5](https://github.com/performclube-ship-it/dexter-photokit-bridge/pull/5),
merge commit `7e2c4c430ab53d5d92fdb90b07789f1fea4f0625`.

**Limitations:** CI exercised source code and unsigned fixtures, not Photos
operations on an actual device. The existing Floot mobile build still omits the
native PhotoKit bridge. The real DEXTER Project ZIP must be inspected privately
before integration, and the Floot web implementation still needs to adopt the
snapshot token API. No new signed TestFlight build, live photo mutation or
App Store submission occurred in this round. The Floot account-wide action
limit reported earlier is separate and must clear before updating its code.

## 23 November 2026 — verified full-count Vision progress (PR #15)

`classifyLocalPages` previously emitted `onProgress(processed === expectedCount)`
immediately after acknowledging the last native batch, before exhausting the
supplied async source. If a later page unexpectedly contained an extra
`PHAsset.localIdentifier`, a user-facing 100% could be shown before the
selection failed with `EXCESS_ASSET_SELECTION`. A claimed empty selection
could also short-circuit without checking that its source was truly empty.

The existing helper now reserves **final progress** until the source is
completely exhausted and its full ID count validated. A zero-count selection
also validates that no pages contain hidden IDs. An in-flight cancellation
after review suppresses the final progress event. Previously acknowledged
local review batches remain counted, not silently discarded. This makes no
PhotoKit album writes and does not store labels, upload images or alter originals.

Four new Node regressions cover zero-count mismatches, normal final progress
after source exhaustion, trailing unexpected IDs and cancellation. Source and
packaged JavaScript remain identical. Both **actual CI workflows passed** for
PR head `eafd0974aee554788b25a9e9ad32bbcb30084dff`:
[unsigned iPhone local-pod run 45113311831](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45113311831)
and [iOS Simulator run 45113311860](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45113311860).
Merged to main through
[PR #15](https://github.com/performclube-ship-it/dexter-photokit-bridge/pull/15),
commit `2cfd73e5d7220936115aec2e69820c89425121e1`.

**Still blocked:** these were unsigned fixture builds and synthetic tests,
not physical iPhone PhotoKit operations. The original Floot DEXTER native
Project ZIP still needs private inspection. Current installed iOS build does
not contain this bridge; no new Floot build, Apple signing, TestFlight upload,
real-photo operation, memory measurement or public App Store submission was
performed. The published web release is unchanged. Account-wide Floot action
quota was previously refused until 23 November 09:00 UTC; do not claim a
fresh typecheck until it actually runs.
