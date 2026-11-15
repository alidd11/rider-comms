# Rider Social — legal, privacy, trust and release-readiness audit

**Reviewed:** 13 November 2026  
**Status:** Engineering assessment only. This is **not** a published privacy policy, a completed DPIA, a legal opinion, or proof of UK Online Safety Act compliance. A qualified UK technology/data-protection solicitor must review legal texts and actual operational controls before launch.  
**Ownership:** Social-only files in PR #449. Rider Comms backend/docs/legal remain owned by the other agent.

## Launch verdict: do not release public UGC, livestreams or monetisation yet

The published Rider Comms [privacy policy](https://alidd11.github.io/rider-comms/privacy.html), [terms](https://alidd11.github.io/rider-comms/terms.html) and [guidelines](https://alidd11.github.io/rider-comms/guidelines.html) (dated 1 October 2026) describe a navigation/voice/rides/messaging product, **not** a full public video social network. The existing Terms expressly describe Rider Comms as personal, non-commercial use; planned Social businesses, paid clubs and creator rewards therefore require a compatible contractual framework. The live legal pages also contain the unresolved phrase “support email to be confirmed”, including in reporting/appeal contexts.

The backend [MODERATION.md](https://github.com/alidd11/rider-comms/blob/main/MODERATION.md) documents real rider reporting, human queue resolution, suspension and audit logging. It does **not** constitute a media-specific moderation, appeal, copyright or marketplace safety pipeline. The Social app currently has no durable, moderated publication backend. Keep real user publishing/checkout disabled until backend services and policies are operational.

## Compliance sources and thresholds

- **Ofcom illegal-content duties:** in-scope user-to-user services must record illegal-content risk assessments, manage relevant risks, enable reporting/complaints, and swiftly remove illegal content once aware. An assessment must be kept current and revisited for material service changes. https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/illegal-content-duties-under-the-online-safety-act
- **Children’s duties:** in-scope providers must assess likely access by children; those likely accessed by children require a children's risk assessment and protections. https://www.ofcom.org.uk/online-safety/protecting-children/protection-of-children-duties-under-the-online-safety-act
- **Age 16 proposal:** UK Government announced under-16 social restrictions in June 2026; Ofcom released its rapid assessment in October 2026. **Do not describe a proposed ban as enacted law.** Self-declaring 16+ does not verify age. https://www.ofcom.org.uk/online-safety/protecting-children/how-age-checks-at-age-16-can-work-to-underpin-uks-social-media-ban
- **ICO Children’s Code:** assess whether under-18s are likely to access the service, complete a suitable DPIA, default to high privacy, minimise data, disable geolocation by default, limit profiling/nudges. https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/
- **Apple UGC guidelines 1.2:** filtering, offensive-content reporting with timely responses, blocking, published contact and effective enforcement. Apple also requires functional account deletion and complete apps for review. https://developer.apple.com/app-store/review/guidelines/
- **UK GDPR privacy and objection rights:** explain controller, purposes/bases, processors/transfers, retention and rights; offer controls for marketing and appropriate objection handling. https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-object/

## Required documents and changes

| Artefact / control | Minimum content and validation | Current status | Responsible owner |
| --- | --- | --- | --- |
| Public legal entity/contact notice | Actual registered entity, contact and service address, appropriate supervisory complaints links | **Missing confirmed contact** | Company + Rider Comms docs |
| Social-specific privacy notice | User videos, photos, comments, metadata, thumbnails, watch/session signals, ranking profiles, creator and business data, ad/marketing usage, partner processors, retention and rights | **Missing** | Company/legal with backend data mapping |
| Social terms + UGC licence | Creator owns uploads; narrowly scoped hosting, transcoding, recommendation and sharing licence; removals, copyright complaints, appeals, conduct, prohibited dangerous riding, minors | **Missing** | Company/legal |
| Child-access, illegal-content and children's risk assessments | Written risk register for UK UGC with hazardous-content exposure, CSEA, grooming, hate, fraud, cyberflashing, illegal stunt promotion, manipulation, direct messages and vulnerable users | **Not evidenced** | Safety lead + legal |
| DPIA and privacy architecture | Data-flow map, minimisation, legal bases, international transfers, processors, profiling, retention and deletion across two apps | **Not evidenced** | Controller, privacy lead |
| Content moderation operations | Durable report intake; case IDs; severity and exposure-based triage; evidence with strict retention/access; policy codes; audits; independent appeals; reversible takedowns | **Social backend missing** | Backend + Trust and Safety |
| Social settings / user rights | Private profile default for protected accounts, discovery controls, follower approvals, DM visibility, block/mute, notification controls, recommendation reset, data export/deletion | **Partly local demo only** | Social UI and shared backend |
| Audio / music and copyright | Licensed audio catalogue, provenance, geographic rights, claim/counterclaim procedure, repeat-infringer process where appropriate | **Missing** | Company/legal + media backend |
| Ads and creator/merchant contracts | Paid promotion labels, prohibited sectors, ad targeting/minors, seller verification, payout/KYC, platform fee, refunds, withdrawal/tax and consumer notices | **Missing** | Company/legal, payments |
| Subscriptions and digital goods | Appropriate store billing, purchase restoration/cancellation, web checkout rules, consumer statutory rights | **Missing** | Company/legal + payments |
| Store privacy disclosures and age ratings | Accurate Apple privacy labels and Google Data Safety entries, age rating, actual screenshots, contact, deletion URL | **Not ready** | Release owner |
| Accessibility and transparency | Screen reader, captioning, keyboard, contrast, settings, plain-English policy links, meaningful appeal status | **Partial** | Social app |

## Cross-app rules that protect riders

- One Rider Comms account and shared block enforcement. Separate audience consent for posts, private clubs and DMs.
- No passive transfer of **precise location**, private rides, home/work locations, navigation history or proximity voice data into Social recommendations, public creator pages or ad targeting. Explicit, granular opt-in for any published route, with sensitive endpoints removed by default.
- Social preference and private-profile changes must be server enforced. A local UI toggle alone is not a privacy guarantee.
- 16–17-year-old users need stricter defaults, age-appropriate communications and profiling safeguards. Do not use self-declaration as proof for legally age-restricted access.
- Moderator notes, abuse evidence and appeals are restricted to authorised staff; audit access, protect complainants, support deletion/retention exceptions and avoid giving reporters another user's sensitive information.

## Release gates and proof

1. Signed-off entity/controller details, privacy notice, Social terms/guidelines, updated Terms acceptance version, accessible links and incident contacts.
2. Recorded risk assessments and DPIA; risk owners, mitigations and review dates.
3. Server-enforced identity/privacy/block/age eligibility and a real media scanning/review/appeal/deletion path.
4. Live UGC report, block, complaint, moderator and appeal tests including false-positive reversals.
5. Consent, data export/deletion and cross-app session/block parity verified; store submissions truthful.
6. Real-device iPhone PWA/iOS/Android walkthrough, accessible screenshots, and exact-head Social + root CI green.

## Requests for Rider Comms

- Confirm and publish company identity and verified privacy/support/reporting contact; fix placeholders in root legal pages.
- Define Social data schema, data-flow inventory, lawful bases, retention, age verification, account deletion/export, and Terms-version acceptance.
- Add server-side privacy and Social UGC/moderation APIs; integrate existing account blocking. Provide report status and appeal records.
- Provide reliable web-native current-user profile and permissions contract; ensure Social data is not inferred from rides/location.
- Confirm operational response capacity, abuse escalation, legal preservation and appeal staffing before enabling UGC.

**Do not publish this audit document as the app’s legal terms.**

## Takeover verification — 13 November 2026 (Shop controls and current Ofcom codes)

- Social-only UI follow-up: when the marketplace contains no eligible live inventory, hide an inert product-search field. The independent empty-state CTA still navigates to Clubs, and the existing production smoke test explicitly verifies the search is absent.
- Storefront navigation follow-up: opening a merchant from a saved product must discard unrelated discovery search, category and vehicle filters, so an approved product is not falsely presented as unavailable. Test this path using isolated fictional listings only; do not imply production commerce exists.
- **Current Ofcom guidance:** the published user-to-user illegal content and protection-of-children Codes of Practice were updated on **2 November 2026**. The prior versions are identified as superseded on Ofcom's regulatory documents page: https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/online-safety-regulatory-documents . The legal and safety owners must assess applicability against these current versions, rather than relying on pre-November 2026 references.
- **Account deletion:** the Social UI now initiates shared-account deletion, but this still requires a disposable-account end-to-end verification. Google Play additionally requires a functional external web deletion-request resource and accurate Play Console data deletion declarations: https://support.google.com/googleplay/android-developer/answer/13327111?hl=en-GB . Neither is established merely by the in-app button.
- No change to the public-UGC release blockers: verified pilot entitlement, media upload/scanning/removal, server-side privacy and moderation, rights/privacy documents, real-device tests and operational approval remain prerequisites.
