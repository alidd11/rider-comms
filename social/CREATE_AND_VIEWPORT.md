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
