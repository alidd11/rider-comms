# Create, upload and viewport product notes

Publicly available product references (reviewed 2026-11-12):
- [YouTube Shorts upload guide](https://support.google.com/youtube/answer/12779649?co=GENIE.Platform%3DAndroid&hl=en): create -> choose/record -> optional trim/edit -> details -> audience/visibility -> upload.
- [TikTok editing/drafts support](https://support.tiktok.com/en/using-tiktok/creating-videos/editing-posting-and-deleting): preview/edit, cover, saving drafts, and device/account limitations.
- [Expo ImagePicker](https://docs.expo.dev/versions/v58.0.0/sdk/imagepicker/): permission-aware media library selection on iOS, Android and Web, with user-gesture constraints on web.
- [Expo Video](https://docs.expo.dev/versions/v58.0.0/sdk/video/): video preview playback across app platforms.
- [Apple web application viewport guidance](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/UsingtheViewport/UsingtheViewport.html): viewport sizing and mobile UX.

## Interaction contract

- Permanent top header and bottom navigation. App root/body never scrolls.
- Feed, clubs, marketplace, and profile have one independently scrolling content area each.
- Reels and Messages are single-viewport surfaces (no page scroll).
- Create has a flexible fixed-height panel; the **editor itself** may scroll for content or keyboard.
- Story viewer fills the available viewport; no page-level scroll.
- Do not use nested full-screen scrollers or screen-sized HTML elements taller than the body.
- Include tests that verify scroll ownership, fixed navigation and accessible keyboard inputs.

## Create preview

1. Choose Post, Story or Reel.
2. Select image(s) or a video from the device through the Expo picker. A Post can have up to six media items, Story one item, Reel one video. Reject unsupported MIME and large files.
3. Display actual selected images/videos with remove/reorder controls; enter a caption and select topic and audience. All audience options are **preview-only**, never publishing permission.
4. Review the assembled draft. Present explicit **Not published** status. Save text-only draft locally if requested, with a clear warning that media will need to be reselected.
5. Production publication will only be enabled after shared authentication, server-derived age eligibility, media ownership, signed upload URL, virus scanning/moderation, transcoding, post finalisation and visibility rules are complete. No unauthenticated upload endpoints or public posts on this branch.

Never store native local photo URIs, raw media, tokens or identity details as persisted drafts. Preview data should remain in device memory only; the text-only saved draft is an intentional exception. File metadata from the device is untrusted and must be revalidated by the future backend.


## Media-first studio v2: implemented interaction pattern

Based on public Meta [Instagram Reels creation documentation](https://about.fb.com/news/2020/08/introducing-instagram-reels/) and TikTok [editing and saving drafts](https://support.tiktok.com/en/using-tiktok/creating-videos/editing-posting-and-deleting), the composer now has distinct full-viewport **Select → Edit → Share details** stages.

- Select: large selection surface and a bottom format switcher. Device library picker opens from the direct tap (Safari user-gesture requirement).
- Edit: selected image/video occupies the main canvas; carousel thumbnails and reorder/remove are accessible. Image aspect presets actually render a centre crop to a new local asset, and Rotate actually rotates using Expo ImageManipulator. Image changes are never silently uploaded.
- Share: image thumbnail plus caption, automotive community selector, audience controls and prominent **Not published**. Text-only drafts can be saved locally; media must be selected again.
- Reels use actual video previews, but *video trimming, licensed sounds, effects, subtitles and cover selection are not yet implemented*. Do not expose false controls for these. Mobile camera selection is supported through Expo ImagePicker.
- The app chrome stays fixed; only the Share details stage scrolls when needed. The Select and Edit stage canvases remain stationary.
- This is a demo preview, not a full production creation/publishing pipeline; the final share/publish control remains disabled until authenticated, age-aware, moderated backend services exist.

Before release, add a real video timeline, reusable audio rights library, covers, text overlays, non-destructive edit graph, actual media draft persistence with user consent, and a secure multipart upload/resumable transcoding pipeline. Continue visual regression testing on iOS Safari and Android.



## Camera-first creation (2026-11-12)

- Create lands directly on the camera stage. When permission is already granted, Expo Camera mounts a real live preview. Otherwise the app asks the user to enable camera on a deliberate tap, with an always-visible Gallery alternative. Denied permission shows device/browser settings guidance.
- The camera-first stage has a large preview, shutter, front/back switch and Post / Story / Reel modes. A captured photo flows into the existing crop/rotate editor and Share details. Native Reel recording supports stop and a 60-second maximum, requesting microphone permission separately at record time.
- iOS Home Screen PWA camera preview requires OS/browser permission. Automated opening of a first-ever permission prompt may be blocked without an interaction; the explicit Enable camera control handles this correctly.
- Browser Reel video recording is not falsely advertised as functional: Expo Camera does not provide consistent cross-browser video recording on iOS PWA, so the interface offers choosing a recorded Reel video from Gallery. Do not label this as full TikTok camera parity until web recording, video editing, audio and permissions have passed real-device tests.
- Camera is mounted only on the Create select stage and unmounts in edit/share or when users leave Create. Media remains a private local preview and is never automatically uploaded.

- On the PWA, the Reel-mode centre control explicitly selects an existing video from the device rather than showing a fake Record button. Native app builds retain camera video recording. Live iOS-PWA video recording will require a separate tested browser capture path.


## Camera → edit → details redesign (2026-11-12)

The screenshot-driven Create redesign follows the familiar recording/editor/details structure of leading consumer social apps without imitating their branding.

1. **Camera** is a full-viewport, rounded media surface. The app's five-tab navigation disappears while composing; Close returns to Home. Post, Story and Reel are real format choices. Photo capture, rear-camera flash, front/rear switching and a 3/10-second timer are functional. Native Reels can record up to 15 or 60 seconds; iOS PWA uses Gallery for video because Expo SDK 58's recordAsync is not available on web. No non-functional music, Live, beauty-filter or effects buttons are shown.
2. **Edit** keeps media as the dominant view, preserves selected order, genuinely rotates/crops photos, supports additional media and rejects unsupported/oversized files. UI tools represent real operations only.
3. **Post details** shows a cover, optional 100-character title, description, manual #/@ insertion, community and audience selection, paid-promotion declaration (local preview only), and a working full-screen post preview. A sticky Drafts action saves text-only information. The Post control stays visibly disabled until publication infrastructure exists; no UI pretends to publish media.
4. **Safety and privacy**: photos/video URIs remain device-memory-only. Text drafts contain no media or tokens and restore mode, title, caption, category and audience. Switching formats after selecting media requires confirmation before discarding.
5. **Viewport**: the Create route owns its safe-area bottom inset, while iOS Dynamic Island top inset remains owned by the outer shell. The app bottom navigation must not appear while the studio is open. Safe-area and interaction tests cover the PWA; actual iOS and Android recording/keyboard behaviour still requires real-device validation.

**Non-negotiable experience rule**: user-facing screens must have a human-designed, AI-free feel. No artificial engagement metrics, AI-themed controls, generated-looking artwork, fabricated media, generic bot language or controls implying unimplemented actions. Use an original restrained identity rather than cloning TikTok visual assets.
