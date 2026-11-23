# DEXTER — revocation of Photos access during native read operations (23 Nov 2026)

Scope: only the existing `DexterPhotoKit` bridge used by Floot project
`7f273ff5-3179-4961-b47b-f464cf562250`. This repository is not a separate app.

Previously, the bridge checked full Photos authorization before scheduling
asynchronous work. If a user switched authorization to denied/limited while
PhotoKit was enumerating a large page, building a local thumbnail, or running
on-device Vision, the pending call could still return metadata or image-derived
data to JavaScript after access had changed.

Each asynchronous read now rechecks `PHPhotoLibrary.authorizationStatus(for:
.readWrite)` after processing and immediately before resolving; previews and
Vision also recheck before each asset. A revoked permission rejects the entire
call with `PHOTOS_PERMISSION_CHANGED`, instead of returning partial pictures or
labels. Snapshot initiation also drops its newly opened token on a late
revocation. Snapshot closure always releases the retained fetch result before
checking permission. This is a **best-effort check** against an asynchronous
authorization race, not an atomic platform security guarantee.

This change does NOT erase already delivered JavaScript data, protect content
already displayed on screen, alter Photos permission prompts, or change the
album-writing transaction. The Floot client should clear in-memory previews,
stop further work, and require a new full-access check on
`PHOTOS_PERMISSION_CHANGED`; it must not downgrade to legacy un-tokened
paging or assume the previous selection is still valid.

The added Node tests inspect the Swift guard arrangement and invariants;
Xcode/CocoaPods CI must pass to prove Swift compilation. Only a **real iPhone**
test with permission revoked during active read/preview/Vision can establish
actual PhotoKit behavior. No Apple originals are changed in these tests.
The local CocoaPod still requires the privately supplied original Floot
Project ZIP and a correctly signed build for device/TestFlight validation.
