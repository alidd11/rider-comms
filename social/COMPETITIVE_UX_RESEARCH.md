# Social UX competitive audit — 12 November 2026

**Status:** Research and product recommendations. Not a statement that all features are implemented. Applies only to the independent Social app. User-facing screens must feel human-designed and native, with no AI-themed copy, generated-looking filler, fake social proof, decorative controls or fabricated transactions. Study patterns, not competitor branding or trade dress.

## Evidence and adaptations

| Platform | Publicly documented pattern | Social application |
| --- | --- | --- |
| Instagram Reels | Meta introduced Friends Reels discovery, credited reposts and controls for friend activity: https://about.fb.com/news/2025/08/new-instagram-features-help-you-connect/ | Immersive full-bleed Reels with compact creator/actions; future Friends/Reposts with genuine attribution, opt-outs and consent-based friendship data |
| TikTok | For You and Following, explicit Not Interested, recommendation explanation, keyword/topic management and non-personalized options where applicable: https://support.tiktok.com/en/using-tiktok/exploring-videos/how-tiktok-recommends-content | Keep feed controls and extend them to Reels without exposing private clubs or rider locations; do not invent stats |
| YouTube Shorts | Creation uses device video selection, video trimming, editing, title (100 chars) and privacy before uploading: https://support.google.com/youtube/answer/12779649?co=GENIE.Platform%3DAndroid&hl=en | Keep camera → edit → details; next add genuine video trimming, cover selection, safe text overlays and authenticated, moderated publishing |
| Snapchat Spotlight / Stories | Spotlight emphasizes vertical video with sound, while Stories favor real creator moments and conversation: https://creators.snapchat.com/create | Separate Story and Reel paths; do not advertise photos as playable video; use permission-aware microphone and licensed audio when available |
| Short-form safe zones | Video fills the viewport while creator text, controls and actions are positioned inside safe regions that vary by device and caption length: https://www.trymacrostudio.com/tools/tiktok-safe-zone-checker | Media extends behind the iPhone Dynamic Island; control surfaces do not. Do not render opaque/translucent bottom bands behind usernames and descriptions |

## Implementation priorities

### P0 — media UX, platform geometry and authenticity
- Reels: full-bleed edge-to-edge media; keep system status legible; top actions below notch; bottom navigation flush; no horizontal dark band or boxed caption. Apply glyph text shadows and verify on bright/dark media.
- Keep carousel swipe paging exact, and never obstruct gestures with full-frame touch blockers. Desktop previous/next actions must land on the next complete Reel.
- Remove prominent DEMO tag and verbose placeholder copy from primary media canvas, while using accurate minimal labels where footage is not real user video.
- Regression tests: forced 59px top safe inset, Reels media y=0 and top control below safe inset, non-Reels header still inset, caption background transparent, screenshots on mobile/desktop.
- Real iPhone Home Screen PWA and Android/iOS native checks remain required.

### P1 — actual creator experience
- Working video trim, non-destructive edit graph, covers, text overlays, music rights, captions, sound/mute, gesture-to-pause, upload progress and safe local drafts; do not show nonfunctional effects/Live/music tools.
- Creator profiles, authentic relationships (Followers vs Friends), Stories privacy, real posts, community discovery, reporting/blocking, attribution and permissions. Repost flow must preserve author attribution and consent.
- Accessibility: clear tap targets, labels, video captions, readable text over bright video, screen-reader behavior, reduced motion and low-connectivity responses.

### P2 — trust and commerce
- Server-side per-user recommendations with transparent feedback, private-content exclusion, moderation, age eligibility, topic controls, reproducible ranking evaluation and strong blocked-user isolation.
- Genuine verified-business commerce, merchant/stock/returns controls, rights-cleared photography, secure checkout and distinct rental/vehicle enquiry flows; no fake reviews or merchant badges.

## Release criteria
1. Every visible button works or accurately explains unavailability; no fake publishing, views, followers, storefronts or recordings.
2. Photos/videos never leak through account, friends, private rides, precise location or recommendations.
3. Confirm independent Social test workflow and root checks on the **exact latest PR head SHA**, then run actual-device review. Leave unrelated branches/PRs unchanged.
4. Keep Social an original interface rather than duplicating TikTok/Instagram visuals or trademarks.
