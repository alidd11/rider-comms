# Trust and safety / moderation design — Rider Social

**Evidence review:** 13 November 2026. **Status:** Design and operational acceptance criteria; **not a working moderation service**. Backend and root docs are owned by Rider Comms, and none were changed for this design.

## Product goal: remove harmful content without unfairly punishing people

Fair moderation should optimise jointly for **safety, decision accuracy, reversibility, transparency and response times**, not simply the number of removals. No model can perfectly judge intent, parody, context, local riding rules, copyrighted music or consensual participation. Reports are signals, **not proof**. Automated systems may prioritise and temporarily quarantine clearly high-risk material where justified, but must not silently create permanent sanctions from one unverified report.

### Lessons from published systems

- TikTok describes combined automation and human review, notification, appeals and reversal; bans and removal appeals can reinstate content and remove strikes. https://support.tiktok.com/en/safety-hc/account-and-user-safety/content-violations-and-bans
- YouTube explains the exact guideline violation, offers appeals, removes wrongful strikes after successful appeal, and says an unsuccessful appeal brings no extra penalty. https://support.google.com/youtube/answer/185111?hl=en
- Meta separates content allowed to exist from content eligible for recommendations (a meaningful distinction between takedown and distribution). https://about.fb.com/news/2020/08/recommendation-guidelines/
- Apple requires filtering, reporting, blocking and public contact information. Google Play requires continuing, effective moderation, reporting and blocking, with proportionate responses. https://developer.apple.com/app-store/review/guidelines/ and https://support.google.com/googleplay/android-developer/answer/9876937?hl=en-GB
- TikTok publishes moderation transparency and appeals data. Its reported automation performance is **TikTok's claim**, not evidence that Rider Social could reach that level. https://newsroom.tiktok.com/digital-services-act-our-sixth-transparency-report-on-content-moderation-in-europe?lang=en-150

## Proposed moderation decisions

1. **Allow:** no confirmed violation. Non-personalised visibility and user-driven audience/privacy decisions remain intact.
2. **Warn / label:** creator correction for a low-harm violation or potentially sensitive legal content; give concrete rules, not vague “community standards”.
3. **Reduce recommendations:** still viewable to intended audience, but ineligible for recommendations for a specified documented policy reason. Creator can see reason and appeal.
4. **Temporary hold / age gate:** narrow temporary control while high-severity evidence is assessed, with time-bound review and appeal.
5. **Remove specific content:** reason code, explicit evidence, timestamps, restore-on-appeal capability, clear follow-up.
6. **Restrict features:** targeted DM/comment/upload/live restrictions with expiry and audit trail, used before full account removal when appropriate.
7. **Suspend account:** for verified serious/repeated harm with proportionate scope and independent review; urgent containment for high-confidence imminent harm.
8. **Emergency escalation:** suspected child sexual abuse material and imminent violence/safety threats follow trained staff, law and preservation procedures. Never casually circulate or view illegal imagery; use approved specialist reporting channel and least-privilege handling.

Separate **user blocks, reports, creator preferences** and **moderator sanctions**. A user choosing “Not interested” or hiding an author is **never a strike**. A high report volume or coordinated brigading is not proof of guilt.

## Case system contract

```text
Content received -> policy scan -> eligible publish / restricted hold
Content/user reported -> deduplicate -> severity queue -> evidence review
-> reasoned decision -> notify and explain -> appeal window
-> separate reviewer -> uphold / modify / reverse -> audit & restore
```

**Case fields:** case ID, target content/user IDs, reporter encrypted ID, reported policy and locale, severity/urgency, contextual media pointers, permission checks, evidence hashes, decision, reviewer ID, reason codes, timestamps, notification/appeal state, automated confidence/version and preservation/expiry instructions. Abuse-report evidence must have finite, documented retention and strict access controls.

**Role separation:** Reporter cannot see sensitive accused details. Accused sees the policy basis and an appropriate amount of evidence without identifying at-risk reporters. Original reviewer cannot decide their own appeal. Every modification is audited with who, when, why and before/after state. Admin privilege checked server-side on every request.

## Preventing false positives

- **Multiple-context review:** check surrounding messages, caption, clip, prior reports, uploader ownership and exemptions (news, critique, education, satirical context) before sanctions. Avoid keyword-only “ban”.
- **Confidence controls:** score for review priority rather than automatic permanent punishment; high-severity material can be temporarily hidden while awaiting prompt human assessment.
- **Labelled training/evaluation data:** independent quality review of anonymised samples, representative accents/languages/motorcycle jargon, sarcasm, disallowed content, minors and unusual edge cases.
- **Appeals:** accessible in Settings → Account status, content page and notices; say what can be appealed, appeal deadline, status and expected response. Reversal restores visibility/engagement where technically possible, removes the strike and corrects recommendations.
- **Strike lifecycle:** clear expiry, per-policy severity, warning vs serious violation; no accumulations from unsubstantiated reports; no extra penalty for an unsuccessful appeal.
- **Anti-brigading:** per-user/report throttles, correlated-signal detection, prevent report flooding from triggering automatic mass bans.
- **Metrics:** precision/recall on independently adjudicated cases, appeal overturn rates, time to first review, time to reverse, repeated offender recurrence, reporter safety, children’s harms, abuse false-negatives, review backlog, demographic fairness checks where lawfully measurable.

## Rider-specific risks requiring dedicated policies

- Dangerous street racing, wheelies/traffic offences, trespassing, illegal vehicle modifications, reckless stunt tutorials and evasion of law enforcement. Avoid recommending videos that incentivise risk; don't treat a lawful track-day clip as criminal solely based on motion.
- Dashcam helmet footage inadvertently showing children, homes, number plates and exact GPS endpoints; give creators crop/blur/removal controls before publishing.
- Harassment or stalking via club events/ride destinations or geotags. Default public event location to broad areas until user consent and event timing permits detail.
- Scams, counterfeit parts, stolen vehicles, deceptive seller listings, misleading safety gear claims and affiliate advertising; business onboarding and payments need distinct enforcement paths.
- Sexualised minors, non-consensual imagery, deepfakes and impersonation; urgent pathways and trained staff. No surface-level AI labelling as a substitute for rights checks.

## Human moderation console — specification (NOT built)

Queue filters by severity, time, policy, age flag and status; playback of evidence in a safe, restricted viewer; policy snippet; one-click reversible hold; reasoned notice composer with standard templates; confirm step for irreversible actions; case assignment and lock; appeal hand-off; side-by-side decision comparison; full audit and export of aggregate monthly transparency metrics. A moderator must not be able to “shadowban” a user by undocumented flag.

## Tests before first real public upload

- Report a post/comment/Reel/club/listing and a user; verify target, evidence, confidentiality, idempotency, queue arrival, status updates.
- Blocked accounts cannot view or DM each other as required by shared Rider Comms policy, including across apps and private clubs.
- Malicious false reports cause **no automatic strike**. Appeal reversal reinstates content, recommendation eligibility and removes a wrongful strike.
- Age-restricted material stays unavailable to underage accounts in the backend and on all clients.
- Quarantined/removed media never appears through cache, CDN, thumbnail, share URL, search, recommendations or notifications.
- Repeated actions and moderator conflicts are transactional, audited, and permission checked.
- Load/incident test for a sudden mass-report event and moderation queue downtime. Test escalation and on-call.
- Screenshot every moderation-related user state on web/iOS/Android; screen readers, text expansion, contrast and touch targets.

## Requests for Rider Comms

1. Extend backend moderation case model with content-level targets, report/status API, reversible holds, strikes and independent appeal decisions.
2. Server-enforce Social visibility, block/privacy/age/moderation eligibility across profiles, media, DMs, clubs, discovery, CDN and checkout.
3. Provide admin RBAC, least privilege, audit log access controls, evidence retention, escalations and trained human operations.
4. Publish accurate moderation timelines, policy reason codes, support escalation and appeal tracking; remove placeholder support contact.
5. Add integrity/false-report controls and monthly safety metrics before allowing real public Social posts.

**Release gate:** This document does not implement these protections; publishing stays disabled until real backend and human operations are verified.
