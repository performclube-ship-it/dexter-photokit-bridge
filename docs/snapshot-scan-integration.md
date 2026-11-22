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
- attempts native snapshot cleanup on all success/failure paths; cleanup errors
  (e.g., SCAN_EXPIRED) never mask the original error
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
