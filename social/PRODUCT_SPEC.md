# Rider Comms ecosystem — social product baseline

**Status:** planning decisions agreed; implementation milestones are not yet approved for release. The public name is undecided. UK-first, internationalisable architecture.

## Two apps, one ecosystem

- **Rider Comms:** navigation, routes, rides, proximity voice, existing friendships and direct messages. No social network UI.
- **Social application:** dedicated separate installed application with its own profiles, content, clubs, events, commerce and monetisation.
- Users can register in either app without the other installed.
- One permanent user ID and unique ecosystem-wide @username. Separate display names, pictures, biographies, preferences and privacy profiles per app.
- Shared friendship graph, account security/blocking and the *same* direct-message conversations across apps; social-only group chats, club channels, event chats, feeds and business messaging stay in the social app.
- Cross-app access is always gated by permissions; shared friendships never imply consent to share live location, private rides or navigation activity.

## Social, communities, commerce — core pillars

- For You (recommendations) and Following (relevance and chronological sorting), with photo/text/video posts and a separate full-screen Reels experience.
- Stories expire after 24 hours; livestreams for eligible creators, clubs, events and verified businesses. Livestream eligibility is based on security, age and standing, **not follower count**.
- Clubs: anybody can create; public, approval-required and private access models; optional authenticity verification for established organisations; club-specific posts with public sharing only where author and club controls permit it. Free and paid tiers with enhanced payout checks.
- Events: individuals and clubs can create public/private events; attendee and venue privacy; RSVPs, organiser permissions.
- Garage: multiple cars, motorcycles and bicycles, with specifications, modifications, photos, build timelines and linked posts. Follow **people**, not individual vehicle entries.
- Shared ecosystem DMs; social-only group chats, club channels, event chats, voice notes and rich media.
- Verified businesses only may sell or rent; users cannot sell. Free basic merchant storefronts, marketplace transaction fees, optional premium business plans. Merchant approval and payout checks distinct from authenticity badge verification.
- Products: in-app physical-goods checkout; vehicle sales: enquiry, inspection and reservation deposit flows; rentals: dedicated eligibility, contract, availability and payment workflow.
- Businesses may pay for clearly labelled ads on posts/products/events/pages. Separate organic ranking and ad auction/delivery. Creator monetisation includes tips, virtual gifts, content rewards, optional paid creator subscriptions, and appropriate controls for paid club membership.
- No confirmed commercial partnership should be inferred from a business proposed as a pilot.

## Age, safety and law

- **Proposed UK social policy:** no social-app access under 16; protected 16–17 experience; verified adults for broadcasting, creator earnings and payout eligibility initially. This is a *product planning assumption subject to the enacted law and legal review*, not a claim of present legal compliance.
- Configure age/feature/country policy on the backend; do not hardcode legislation into UI. Provider-based age assurance with alternatives, appeals, retention minimisation, rechecks and audit trail.
- Livestream moderation, advertising disclosure, creator licensing, copyright, scam prevention, age-aware recommendations and UGC reporting/blocking are release requirements.
- Business payments, in-app digital goods, payouts, taxes, seller of record, rentals and UK marketplace duties require distinct legal/payment-provider assessment.
- UK first; plan for i18n, multiple currencies, time zones, regional feature availability and pricing. Do not launch international features without local compliance.

## Algorithm intentions

- Separate ranking systems for For You, Reels, clubs, events, marketplace and ads.
- Following can be chronological. Users can say Not Interested, inspect why recommendations appear and manage interests.
- Never leak private club/event content or Rider Comms live/precise location into recommendations or ads.
- Start transparent and simple; evaluate measured relevance, retention, community participation, diversity, safety, and small-creator discovery before advanced models.
- Paid business subscriptions do not buy organic ranking or a verification badge.

## UX and engineering acceptance

- Separate iOS, Android and web release targets. Portrait-only native phone layout. Web orientation safeguards only where browser supports them.
- Independent CI and app boundaries; gradual integration through tested shared APIs.
- Support keyboard, accessible labels, dark/light contrast, loading/empty/error states and unreliable connectivity.
- Do not confuse a visual prototype with implemented production functionality.

## Initial engineering milestone

1. Isolated Expo app and a responsive dark-first design foundation.
2. Interactive **demonstration** of For You / Following order, Reels entry, club and event directory, verified-only marketplace and profile/garage shell.
3. Pure domain policy tests demonstrating private content does not enter public feeds and non-approved businesses cannot sell.
4. No backend, root dependency, shared migration or current Rider Comms app changes.
5. Next: independent automated web/native smoke tests and feature-by-feature integration after coordination with Claude.
