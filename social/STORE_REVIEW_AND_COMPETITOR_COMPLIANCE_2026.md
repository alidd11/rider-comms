# Rider Comms Social — Store Review and competitor compliance assessment

Reviewed: **13 November 2026**. Evidence: PR #449 Social code, previous Social legal/privacy/security audits, latest official Apple, Google, UK and EU publications linked below. **This is an engineering gap assessment, not legal advice, storefront approval or a completed statutory assessment.** Statuses: verified = backed by evidence; partial = client or foundation only; blocked = required release functionality absent; future = not currently enacted or applicable only after feature launch.

## Release verdict — PUBLIC LAUNCH BLOCKED

The native build remains a development package: Social — Development, version 0.0.1, bundle ID com.ridercomms.social.dev (social/mobile/app.json). Existing shared Rider Comms authentication, friends and friend-scoped messaging run in the Social pilot, but the production Social media feed does not have a moderated publishing backend. Creator earnings, media uploads, live inventory, checkout and policy/legal approval have not been delivered. The publicly reachable preview is NOT server-enforced invitation-only. Passing visual smoke tests does not qualify this for Apple App Store or Google Play submission.

Backend release dependency: GitHub issue #466. UI implementation and evidence: draft PR #449. Do not merge or release the project as production Social until the owner of each blocker supplies verifiable evidence.

## Apple App Review / Google Play matrix

| ID | Official requirement | Social evidence and gap | Priority, owner and proof |
| --- | --- | --- | --- |
| A1 | Apple **1.2 and 1.2.1**: filter objectionable UGC, in-app report content/users, timely review, block abusive accounts, publish contact information. Creator content follows same rules. October 2026 clarification explicitly includes nonconsensual intimate imagery. | Shared Rider Comms moderation exists but a Social-specific media/report/moderation/appeal process and in-app report/block across Social surfaces are not verified. | **P0 blocked** — backend/Trust & Safety; demonstrate report post, Reel, creator, comment, DM, block, moderator response, takedown and appeal including cross-client enforcement. |
| A2 | Apple **2.1**: a submitted app must be complete and testable; **2.5.19**: do not conceal/reveal capabilities after review or misrepresent functionality. | Composer and Shop currently represent preview capabilities; test-fixture posts/products do not exist in production. | **P0 blocked** — release owner; final functional app, no deceptive UGC/checkout claims, complete review notes and reviewer demo credentials or preapproved full demo. |
| A3 | Apple **5.1.1(v)**: app with signup requires in-app account deletion. Google Play also requires an in-app account deletion route AND a publicly reachable web deletion request URL in Play Console. | Social Settings now adds a **two-step in-app delete account action**, using the existing Rider Comms authenticated DELETE /auth/me endpoint, with explicit subscription warning and synthetic success/failure tests. Clearing local drafts alone was never account deletion. Real backend deletion, associated processor cleanup and externally listed Play Console deletion resource remain **unverified**. | **P0 partial** — Social UI wired, but shared backend/privacy/release owners must verify full account and associated processor data removal, published external deletion URL, and legal retention. |
| A4 | Apple privacy policy & App privacy details; Google Play User Data/Data Safety declarations, consent and deletion. | Existing Rider Comms legal pages do not fully document Social UGC, watch signals, creator/merchant data, profiling, retention or third-party SDKs. Confirmed controller/contact and current valid policies are missing. | **P0 blocked** — company/legal/privacy; approved policy, actual collection/processor map, privacy labels, data export/deletion/retention tests. |
| A5 | Apple **4.8** requires a privacy-preserving equivalent login option if third-party/social authentication creates primary accounts, subject to exceptions. | Only first-party Rider Comms account setup/sign-in is evidenced. **Sign in with Apple is not automatically mandatory with only a first-party login.** | Monitor — auth/release. Reassess if Google/Facebook/etc. signup added. |
| A6 | Apple **3.1.1 / 3.1.3(e)** and Google Play Payments: native digital content, subscriptions, creator gifts/boosted posts normally use store billing unless specific regional programmes/entitlements apply; physical goods and external-consumption services generally use another payment method. | Digital monetisation and physical Shop are not enabled with production billing. | **P0 before monetisation** — payments/legal; region-specific SKU classification, IAP sandbox and restore/refund tests, merchant KYC, physical-goods PSP and consumer-rights disclosures. |
| A7 | Apple **5.2**: intellectual-property rights, licensed music/third-party media, truthful metadata. | No approved creator/audio licences, takedown or counter-claim procedures evidenced for published media. | **P0 before UGC** — legal/media; licensing register, DMCA/UK copyright complaint and appeal process, NCII/child safety operations. |
| A8 | Complete App Store/Google Play metadata: bundle IDs, final title, accurate age rating, permission usage strings, screenshots, privacy and support URLs. | Current native metadata explicitly says Development 0.0.1; Expo camera/image-picker permissions exist, physical-device testing not certified. | **P0 blocked for submission** — release/mobile; production IDs, screenshots, App Review test access, actual permission denial and session tests, review age-rating disclosures. |
| G1 | Google Play UGC policy: ongoing moderation, user-policy acceptance before uploads, ability to report content/users and block peers for 1:1 interaction; monetisation must not reward harmful UGC. | DM API is connected but no end-to-end Social in-app report/block UX verified. | **P0 blocked** — backend/Social; repeatable report/block and case-handling tests plus minor-safety content policy. |
| G2 | Google Play account deletion and Data Safety: in-app + external web deletion, complete processor/retention disclosure. | Rider Comms support documentation points signed-in users to account deletion on the existing web app, but no independently verified dedicated external deletion URL or completed Play Console Data Safety form is evidenced. | **P0 blocked** — shared account owner and Play Console release owner. |

### Official store policy sources (checked 13 November 2026)

- Apple guidelines (updated **16 October 2026**): https://developer.apple.com/app-store/review/guidelines/
- Apple's October 2026 UGC, NCII and hidden-feature amendments: https://developer.apple.com/news/?id=92th7e5i
- Google Play UGC: https://support.google.com/googleplay/android-developer/answer/9876937?hl=en-GB
- Google Play account deletion: https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
- Google Play payments: https://support.google.com/googleplay/android-developer/answer/9858738?hl=en

## UK / EU safety, minors and privacy obligations

| Area | Actual current status | Required evidence |
| --- | --- | --- |
| UK Online Safety Act | Determine whether each Social/DM user-to-user capability is in scope. For in-scope services, Ofcom requires an illegal-content risk assessment, appropriate mitigation, accessible reports/complaints and ongoing review. | Recorded risk register covering CSEA, grooming, nonconsensual intimate imagery, harassment, hate, terrorism, fraud, serious self-harm, cyberflashing and dangerous riding promotion, with owners and operating policies. |
| Children likely to access | Ofcom child-access assessment considers users **under 18**, even if marketed to 16+. Self-checking 16+ is not verified age. | Legally evaluated child access/age assurance, applicable children risk assessment and risk mitigations, stranger DM/livestream protections. |
| ICO Children's Code and GDPR | High privacy by default, no default geolocation sharing, no under-18 profiling by default absent a compelling reason, honest notices and data minimisation. | Data-flow inventory, appropriate DPIA, verified authority/privacy defaults and data subject rights. Social changed local recommendation-personalisation default to **Off** on this audit; future production ranking requires server-side age-aware enforcement. |
| UK announced future social restrictions | September 2026 government guidance **plans** under-16 restrictions for spring 2027, with future default safeguards for 16–17 users including restricted late-night access, autoplay, personalised feeds and stranger interaction. These are **planned changes, not a claim of enacted law as of this review**. | Follow final legislation/commencement dates; versioned jurisdiction/age feature controls and safe defaults. |
| EU Digital Services Act | Conditional on actual EU provision and service classification. Not all platform, VLOP or trader obligations apply to every small service. | Counsel's applicability matrix, contact points, moderation notices and reasons, complaints/appeals, recommender/ad transparency and minors' protections as relevant. |
| Rider-specific location/voice privacy | Route endpoint exposure, home/work locations, hideouts, private rides, live proximity voice and location history are particularly sensitive; Social must not silently inherit them. | Independent Social sharing consent, redacted map endpoints and privacy audience, backend enforcement, explicit opt-in; no location-derived ads/recommendations by default. |
| Consumer commerce | Merchant verification, physical vs digital checkout, advertising and creator payouts require further legal analysis, trader transparency, withdrawal/refunds, KYC and tax. | Approved contracts, payment processor sandbox, disclosure and support operations. |

### Official UK/EU sources

- Ofcom illegal-content duties (updated 25 June 2026): https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/illegal-content-duties-under-the-online-safety-act
- Ofcom child-access assessment (updated 29 June 2026): https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/childrens-access-assessment-duties-under-the-online-safety-act
- ICO Children's Code: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/introduction-to-the-childrens-code/
- ICO default profiling rules: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/best-interests-self-assessment/step-4-prioritise-actions/recommended-actions-in-the-children-s-code/
- UK government September 2026 age proposal and timeline: https://www.gov.uk/government/publications/fact-sheet-new-rules-to-protect-children-online/fact-sheet-new-rules-to-protect-children-online
- UK government July 2026 16–17 default protection plans: https://www.gov.uk/government/consultations/growing-up-in-the-online-world-a-national-consultation/outcome/growing-up-in-the-online-world-government-response-july-2026
- European Commission DSA FAQ: https://digital-strategy.ec.europa.eu/en/faqs/digital-services-act-questions-and-answers

## Competitor UX — preserve principles, not copyrighted interfaces or assets

| Platform | Verified public practice | Social design/control recommendation |
| --- | --- | --- |
| Instagram | Following/Favorites chronological views and post-level not-interested feedback. 2025 trials also tested Reels-first navigation; that trial is not necessarily universal today. | Make For You and Following clearly different surfaces, transparent chronological following, accessible feedback and a consistent Create destination. |
| TikTok | For You and Following feeds, explanation of recommendations, keyword/topic filters and Not Interested/refresh. | Show effective preference control and why content appears. Do not pretend a local-only preview is real personalised production ranking. |
| YouTube | Report videos, Shorts, creators and comments, with human review rather than auto-removal based on number of flags. | Real case status, reviewed decisions and appeal, avoid mass-report punishment. |
| Strava | Activity audience and map visibility are separate; hide home/route start and end or full map. | Separate public social profile/post audience from any route redaction; never import riding location silently. |
| Apple HIG | Persistent top-level tabs are for navigation; tab labels matter; Dynamic Type and safe-area layout must adapt. | Review whether central Create is visually an action rather than a normal tab; preserve keyboard/large-text and >=44pt touch targets. |

### Competitor/UX primary sources

- Instagram Following/Favorites: https://about.fb.com/news/2022/03/two-new-ways-to-control-your-instagram-feed/
- Instagram 2025 Reels-first test: https://about.fb.com/news/2025/09/in-india-instagram-debuts-a-reels-first-experience-for-its-mobile-app/
- TikTok recommendation logic: https://support.tiktok.com/en/using-tiktok/exploring-videos/how-tiktok-recommends-content
- TikTok For You management: https://support.tiktok.com/en/getting-started/for-you/test-for-you
- YouTube content reporting: https://support.google.com/youtube/answer/2802027?hl=en-GB
- Strava map visibility (September 2026): https://support.strava.com/en-us/articles/15402012-how-do-i-edit-my-map-visibility-on-strava
- Apple tab bar HIG: https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Apple Dynamic Type layouts: https://developer.apple.com/design/human-interface-guidelines/layout

## Release acceptance checklist

Before other beta users:
- [ ] Server-enforced Social invitation entitlement on every Social and media endpoint, tested with two separate accounts (#466).
- [ ] Verify content/user/message report and block controls in both Social and Rider Comms, including back-end action and appeal.
- [ ] Approved contact/controller, privacy and T&Cs, accessible with functional links.
- [ ] Ofcom applicability and child-access assessment, illegal-content risk assessment, privacy data mapping, any required DPIA.
- [ ] Valid age/entitlement gates; no implied verified age from a checkbox or unvalidated device state.
- [ ] Own-account and private-club/media authorization tests; location and voice data cannot leak into Social.

Before App Store / Google Play:
- [ ] Verify Social's new two-step in-app account deletion on the real shared backend with a dedicated disposable test account; confirm all associated data, subscription warnings and processor retention.
- [ ] Production app identity, bundle, version/build, icons, accurate age-rating and genuine screenshots.
- [ ] Working shared-account deletion in app; functional public deletion URL for Google, complete retention/processor handling.
- [ ] Moderated live UGC or explicitly non-UGC fully functional experience; no hidden post-review feature switching.
- [ ] Operational in-app report/block, media scanning/NCII/copyright takedowns, appeal and safety staffing.
- [ ] Apple privacy labels, Google Data Safety form, reviewed privacy/terms/contact details and SDK inventory.
- [ ] Store-specific in-app billing for digital goods, other payments for qualifying physical goods, regional exceptions evaluated.
- [ ] Real iPhone and Android camera, microphone, permissions, background resume, keyboard, VoiceOver/TalkBack, large text and network failure testing.
- [ ] App Review access credentials and release notes, exact commit/binary+CI hashes, accountable company/legal and release sign-off.

The current preview, test screenshot coverage and green build are NOT a substitute for the above evidence. This report is not a public legal notice, and should not be represented to users or storefront reviewers as certification.
