# DEXTER: snapshot-paged client adapter (22 Nov 2026)

The native PhotoKit plugin's `beginAssetScan` / `getAssetsPage` /
`endAssetScan` calls now have a tested, pure-JavaScript coordinator in
`dist/snapshotScan.js`. It is **not yet installed in the live Floot app**.
Do not interpret JS unit tests as physical-device results.

`scanSnapshotPages({ plugin, onPage, pageSize, maxItems, shouldStop, onProgress })`
- requests full Photos permission and rejects limited/denied access
- starts a new native snapshot at **offset 0** every invocation; old tokens do
  not survive app restarts and must NEVER be persisted or replayed
- sends the same opaque token with every page, detects malformed page lengths,
  nextOffset, duplicate asset identifiers, invalid metadata and changed totals
- requires `onPage` to *durably merge records by PHAsset.localIdentifier*
  BEFORE advancing progress; a failed write stops without false success
- stops safely at a user-requested boundary; when maxItems < total, reports
  `limit_reached` with `complete:false`, not a fully scanned library
- requires the final native snapshot-close acknowledgment before reporting
  `complete`; a Photos mutation during durable persistence makes close reject
  and fails closed. The original page read/storage error remains primary
- checks cancellation again after a native page arrives, before persisting it
- releases native snapshot resources on success/failure; an invalidated close
  cannot turn a partial or stale scan into a verified success
- never reads pixels and never creates, changes, moves or deletes Apple photos

**How to adopt inside the ORIGINAL Floot project when its action quota clears:**
Copy the helper into `helpers/` with appropriate TypeScript import or use
its typed export if the plugin is ever published. Keep the app's existing
`registerPlugin('DexterPhotoKit')` contract when using the export/local-pod
route. Adapt `dexterEngine.scanIOSPage` and `pages/_index.tsx` so that the
coordinator owns the entire sequence instead of nested
`getAssetsPage(offset,limit)` calls; use the existing merge/persist functions
inside `onPage`. Do not write progress on a failed persistence callback.
A new invocation starts from offset 0 and merges old records by ID to avoid
skipping changed libraries; retain previously assigned album labels.
Use visible UI for `stopped` and `limit_reached` distinct from `complete`.

This is a contract implementation ready to integrate, **not** proof that the
real user's 10,000+ photos have been processed. Test a small library in
TestFlight first; increase to 10,000 only after device measurements of memory,
permissions, interruption and iCloud availability. This does not remove the
original private Project ZIP, Apple signing or TestFlight prerequisites.

## Verified GitHub integration (22 Nov 2026)

PR [#6](https://github.com/performclube-ship-it/dexter-photokit-bridge/pull/6)
was merged to `main` at commit `d31e35a3ba621fa85ffe9c5aabeab0d3dda05238`.
The following PR-head checks completed successfully against commit
`7d3e91c78cb31fc6b6221dfc06e43041fc3f0b61`:

- [iOS Simulator Xcode/CocoaPods + Node regressions](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45062371372) — success
- [Unsigned iPhone/arm64 local CocoaPod + Node regressions](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45062371489) — success

These runs validate packaging, compilation and the scanner against synthetic
assets. They do **not** mean that the new JS coordinator is already used by
DEXTER on Floot, that the native plugin is installed on an actual iPhone, or
that Apple PhotoKit permissions and changes have been tested on a real library.
The original Floot Project ZIP is still needed for the no-npm native route;
Floot's daily build-action quota reported on 22 November must be rechecked
only after 23 November at 09:00 UTC (or after a confirmed quota change).

## Final close consistency gate (22 Nov 2026, 20:48 UTC)

PR [#7](https://github.com/performclube-ship-it/dexter-photokit-bridge/pull/7)
was squash-merged into `main` at commit
`cec220900b78db9000993e5e4d7b41330d321a56`.
The scanner previously ignored *all* `endAssetScan` failures; a Photos
mutation arriving while `onPage` durably wrote the last page could produce
a misleading `complete` result. Swift now releases its fetch session and
rejects `LIBRARY_CHANGED` when the close sees an invalidated snapshot.
JavaScript requires an affirmative `ended: true` response before returning
success and preserves any earlier read or persistence failure as the primary
error. A stop requested during an in-flight native page prevents that page
from being persisted.

CI evidence on PR head `43aea8898a1bece80e72b25756f7f2dc2f15c9e2`:
- [iOS Simulator + Node and CocoaPods](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45068028113): success
- [iPhone arm64 SDK unsigned local-pod](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45068028067): success

New regressions simulate invalidation during a slow durable write, refused
native end acknowledgment, error precedence and cancellation during a page
fetch. **This is a conservative final in-process check, not a transactional
snapshot**: notifications delivered after the close can still occur. No
TestFlight upload, real-device Photos test or Floot installation occurred.
The real original Floot native ZIP is still required to integrate the bridge
without publishing to npm; no native build quota was consumed in this round.

## Final-progress acknowledgment and invalid-begin cleanup (22 Nov 2026)

The scanner now defers the **last** `onProgress` event until native
`endAssetScan` returns `{ended:true}`. This prevents showing 100% while a
last-page durable write is still vulnerable to PhotoKit invalidation. A
completed scan still requires independent UI state confirmation; an earlier
page may be saved even if close fails. Stopped progress remains accurate.

A malformed `beginAssetScan` total accompanied by a usable native token is
explicitly cleaned up before rejecting. Invalid tokens are never forwarded to
the native bridge; a cleanup exception cannot hide the original validation
error. Synthetic Node regressions cover each case; real-device behavior is
**not** inferred from these tests.

## Verified final-progress fix (22 Nov 2026, 22:40 UTC)

Merged [PR #9](https://github.com/performclube-ship-it/dexter-photokit-bridge/pull/9)
at commit `5403a4e2bb90e09d597d015b272d23d9ca9e2f0f`.
Before this fix the coordinator could dispatch the final `onProgress`
*before* `endAssetScan` verified the native snapshot. A mutation during
the last durable save could reject completion after UI progress had already
reached 100%. The final progress event is now deferred until verified close.
A malformed native `beginAssetScan` total with a usable token also triggers
explicit cleanup, keeping the original validation error primary.

Five new synthetic regressions run with the full Node test suite. Verified
completed/success GitHub Actions runs for the PR-head commit
`0fca30fc37d8d4b2322ee78762e6b559889d2ca3`:

- [iOS Simulator CocoaPods/Node](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45078787035) — success
- [Unsigned iPhone SDK local CocoaPod/Node](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45078787046) — success

The corresponding push runs
[45078777897](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45078777897)
and [45078777892](https://github.com/performclube-ship-it/dexter-photokit-bridge/actions/runs/45078777892)
also succeeded. These are **synthetic code tests and unsigned native builds**.
The original Floot iOS export has still not been supplied, no PhotoKit test
on a real iPhone has occurred, and this code is not in the TestFlight binary.
The native plugin remains unpublished to npm. No photographs were modified.
