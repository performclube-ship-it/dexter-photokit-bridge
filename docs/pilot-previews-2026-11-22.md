# DEXTER: bounded local pilot previews — 22 November 2026

This adds a native PhotoKit bridge method for user-initiated review of up to
ten original PHAssets, not a new app and not yet a shipped Floot UI feature.

Safety: native full Photos permission, unique asset identifiers, hard ten-image
limit, one active preview request at a time, missing asset refusal. Each
thumbnail is requested at 128×128 px with `isNetworkAccessAllowed=false`,
resized locally and encoded to JPEG no larger than 64 KiB. iCloud-only assets
return `status:"icloud"` instead of triggering downloads. No originals are
copied, moved, deleted or uploaded. Other errors return `status:"unavailable"`.
No metadata scan ever renders image pixels. The bridge returns on-device
data URLs to the Capacitor WebView only. The UI must not log, persist,
synchronize or upload thumbnails and must clear them when review closes
or the app locks. Privacy must be checked in the actual exported app.

Run `npm test` and both Xcode/CocoaPods unsigned CI workflows after this
change. This is NOT proof of runtime success. Before activating in DEXTER:
inspect the original Floot Project ZIP, ensure current JS integration, test
denied/limited/full permissions, local photos and video frames, iCloud-only
images, repeated taps, real iPhone memory and album membership on device.
No public App Store submission before signed TestFlight and device testing.

Apple: https://developer.apple.com/documentation/photos/phimagemanager/requestimage(for:targetsize:contentmode:options:resulthandler:)
Apple: https://developer.apple.com/documentation/photos/phimagerequestoptions/isnetworkaccessallowed
