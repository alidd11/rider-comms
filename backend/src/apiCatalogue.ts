import type { StaffPermission } from './staffRoles.ts';

/**
 * Every HTTP endpoint the backend serves, in one place. It is the source of
 * GET /openapi.json, and tests/apiCatalogue.test.ts fails when a route in
 * src/routes is missing here, so the published contract can't drift from
 * the code. Paths are relative to the API root; each also answers under /v1.
 */
export type Access = 'public' | 'rider' | 'staff';

export interface Endpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
  path: string;
  summary: string;
  tag: string;
  access: Access;
  /** For staff endpoints: the permission it needs (staffRoles.ts). */
  permission?: StaffPermission;
  /** Staff changes also need a recent password re-check. */
  reauth?: boolean;
}

const e = (method: Endpoint['method'], path: string, tag: string, access: Access, summary: string, extra: Partial<Endpoint> = {}): Endpoint =>
  ({ method, path, tag, access, summary, ...extra });

export const API_ENDPOINTS: readonly Endpoint[] = [
  e('GET', '/health', 'Service', 'public', 'The process is running'),
  e('GET', '/ready', 'Service', 'public', 'The database is reachable and migrated'),
  e('GET', '/config', 'Service', 'public', 'Public client configuration'),
  e('GET', '/openapi.json', 'Service', 'public', 'This API description'),
  e('POST', '/client-errors', 'Service', 'public', 'Report an app crash or error'),

  e('POST', '/auth/signup', 'Account', 'public', 'Create an account'),
  e('POST', '/partners/apply', 'Partners', 'public', 'Apply to sell or advertise on Rider Comms; no account needed, rate-limited per address, reviewed by staff'),
  e('POST', '/auth/login', 'Account', 'public', 'Sign in'),
  e('POST', '/auth/staff-login', 'Account', 'public', 'Sign in to the Operations Hub using existing rider credentials; non-staff accounts are refused and any issued token is revoked'),
  e('POST', '/auth/verify-email', 'Account', 'public', 'Verify an email address with its link token'),
  e('POST', '/auth/password-reset/request', 'Account', 'public', 'Email a password reset link'),
  e('POST', '/auth/password-reset/confirm', 'Account', 'public', 'Set a new password with a reset token'),
  e('GET', '/auth/me', 'Account', 'rider', 'The signed-in account'),
  e('DELETE', '/auth/me', 'Account', 'rider', 'Delete the account and its data'),
  e('POST', '/auth/accept-terms', 'Account', 'rider', 'Accept the current Terms'),
  e('GET', '/announcements/current', 'Account', 'rider', 'The announcement staff scheduled for riders now, if any'),
  e('GET', '/auth/sessions', 'Account', 'rider', 'Signed-in devices'),
  e('DELETE', '/auth/sessions/{sessionId}', 'Account', 'rider', 'Sign out one device'),
  e('POST', '/auth/logout', 'Account', 'rider', 'Sign out this device'),
  e('POST', '/auth/reauthenticate', 'Account', 'rider', 'Re-enter the password before staff changes'),
  e('GET', '/auth/export', 'Account', 'rider', 'Download all data held about the rider'),
  e('GET', '/auth/security-events', 'Account', 'rider', 'Sign-ins and other account security history'),
  e('POST', '/auth/resend-verification', 'Account', 'rider', 'Send the verification email again'),

  e('GET', '/push/web-key', 'Notifications', 'rider', 'Public key for web push'),
  e('PUT', '/push/subscriptions', 'Notifications', 'rider', 'Register this device for notifications'),
  e('DELETE', '/push/subscriptions', 'Notifications', 'rider', 'Stop notifications on this device'),

  e('GET', '/billing', 'Billing', 'rider', 'The rider\'s plan'),
  e('POST', '/billing/verify', 'Billing', 'rider', 'Record an App Store or Google Play purchase'),
  e('POST', '/billing/apple/notifications', 'Billing', 'public', 'App Store server notifications'),
  e('POST', '/billing/google/notifications', 'Billing', 'public', 'Google Play developer notifications'),

  e('POST', '/rides', 'Rides', 'rider', 'Start a group ride'),
  e('POST', '/rides/join', 'Rides', 'rider', 'Join a ride by code'),
  e('GET', '/rides/current', 'Rides', 'rider', 'The ride the rider is in'),
  e('GET', '/rides/{rideId}', 'Rides', 'rider', 'A ride and its members'),
  e('DELETE', '/rides/{rideId}', 'Rides', 'rider', 'End a ride (leader)'),
  e('POST', '/rides/{rideId}/leave', 'Rides', 'rider', 'Leave a ride'),
  e('DELETE', '/rides/{rideId}/members/{riderId}', 'Rides', 'rider', 'Remove a member (leader)'),
  e('PUT', '/rides/{rideId}/regroup', 'Rides', 'rider', 'Set the regroup point'),
  e('DELETE', '/rides/{rideId}/regroup', 'Rides', 'rider', 'Clear the regroup point'),
  e('PUT', '/rides/{rideId}/location-sharing', 'Rides', 'rider', 'Share or stop sharing location in the ride'),
  e('POST', '/rides/{rideId}/location', 'Rides', 'rider', 'Send a position'),
  e('GET', '/rides/{rideId}/locations', 'Rides', 'rider', 'Members\' latest positions'),
  e('POST', '/presence', 'Nearby', 'rider', 'Share position for Nearby'),
  e('DELETE', '/presence', 'Nearby', 'rider', 'Stop appearing on Nearby'),
  e('POST', '/voice/token', 'Voice', 'rider', 'A voice token for a ride or Nearby pair'),

  e('POST', '/directions', 'Navigation', 'rider', 'Route between places'),
  e('POST', '/places/autocomplete', 'Navigation', 'rider', 'Place suggestions'),
  e('POST', '/places/details', 'Navigation', 'rider', 'One place'),
  e('POST', '/places/along-route', 'Navigation', 'rider', 'Places along a route'),
  e('POST', '/places/search', 'Navigation', 'rider', 'Search places'),
  e('POST', '/places/nearby', 'Navigation', 'rider', 'Places nearby'),
  e('POST', '/hazards', 'Hazards', 'rider', 'Report a road hazard'),
  e('GET', '/hazards/nearby', 'Hazards', 'rider', 'Hazards nearby'),
  e('POST', '/hazards/along-route', 'Hazards', 'rider', 'Hazards along a route'),
  e('POST', '/hazards/{hazardId}/confirm', 'Hazards', 'rider', 'Confirm a hazard is still there'),
  e('POST', '/hazards/{hazardId}/deny', 'Hazards', 'rider', 'Say a hazard has gone'),
  e('DELETE', '/hazards/{hazardId}', 'Hazards', 'rider', 'Delete your hazard report'),
  e('GET', '/scenic-routes', 'Scenic routes', 'rider', 'Scenic routes'),
  e('POST', '/scenic-routes', 'Scenic routes', 'staff', 'Publish a scenic route'),
  e('GET', '/scenic-routes/{routeId}', 'Scenic routes', 'rider', 'One scenic route'),
  e('DELETE', '/scenic-routes/{routeId}', 'Scenic routes', 'staff', 'Remove a scenic route'),

  e('GET', '/profiles/{riderId}', 'Profiles', 'rider', 'A rider\'s public profile'),
  e('POST', '/profiles/batch', 'Profiles', 'rider', 'Several public profiles'),
  e('GET', '/riders/{riderId}/profile', 'Profiles', 'rider', 'Your own profile'),
  e('PUT', '/riders/{riderId}/profile', 'Profiles', 'rider', 'Edit your profile'),
  e('GET', '/riders/{riderId}/friends', 'Friends', 'rider', 'Your friends'),
  e('DELETE', '/riders/{riderId}/friends/{friendId}', 'Friends', 'rider', 'Remove a friend'),
  e('GET', '/riders/{riderId}/friend-requests', 'Friends', 'rider', 'Your friend requests'),
  e('GET', '/riders/{riderId}/hideouts', 'Friends', 'rider', 'Your hideouts'),
  e('POST', '/friends/requests', 'Friends', 'rider', 'Send a friend request'),
  e('DELETE', '/friends/requests/{requestId}', 'Friends', 'rider', 'Cancel a friend request'),
  e('POST', '/friends/requests/{requestId}/accept', 'Friends', 'rider', 'Accept a friend request'),
  e('POST', '/friends/requests/{requestId}/decline', 'Friends', 'rider', 'Decline a friend request'),
  e('GET', '/friends/activity', 'Friends', 'rider', 'Friends\' recent activity'),
  e('GET', '/social/events', 'Friends', 'rider', 'Live updates (server-sent events)'),
  e('GET', '/conversations', 'Messages', 'rider', 'Conversations'),
  e('GET', '/messages', 'Messages', 'rider', 'Messages with a friend'),
  e('POST', '/messages', 'Messages', 'rider', 'Send a message'),
  e('POST', '/messages/read', 'Messages', 'rider', 'Mark messages read'),
  e('GET', '/messages/unread-count', 'Messages', 'rider', 'Unread message count'),
  e('POST', '/messages/typing', 'Messages', 'rider', 'Tell a friend you are typing'),
  e('DELETE', '/messages/{messageId}', 'Messages', 'rider', 'Delete a message you sent'),
  e('POST', '/hideouts', 'Friends', 'rider', 'Create a hideout'),
  e('DELETE', '/hideouts/{hideoutId}', 'Friends', 'rider', 'Delete a hideout'),
  e('GET', '/blocks', 'Safety', 'rider', 'Blocked riders'),
  e('POST', '/blocks', 'Safety', 'rider', 'Block a rider'),
  e('DELETE', '/blocks/{riderId}', 'Safety', 'rider', 'Unblock a rider'),
  e('POST', '/reports', 'Safety', 'rider', 'Report a rider'),

  e('GET', '/social/bootstrap', 'Rider Social', 'rider', 'What Rider Social can do for this rider'),
  e('POST', '/social/media', 'Rider Social', 'rider', 'Upload a photo or video'),
  e('POST', '/social/posts', 'Rider Social', 'rider', 'Publish a post'),
  e('GET', '/social/feed', 'Rider Social', 'rider', 'The feed (for-you, following or reels)'),
  e('GET', '/social/riders/{riderId}/posts', 'Rider Social', 'rider', 'A rider\'s posts'),
  e('GET', '/social/posts/{postId}', 'Rider Social', 'rider', 'One post'),
  e('DELETE', '/social/posts/{postId}', 'Rider Social', 'rider', 'Delete your post'),
  e('POST', '/social/posts/{postId}/report', 'Rider Social', 'rider', 'Report a post'),
  e('GET', '/social/media/{mediaId}/file', 'Rider Social', 'public', 'A photo or video, by signed link'),
  e('GET', '/social/media/{mediaId}/poster', 'Rider Social', 'public', 'A video poster, by signed link'),

  e('GET', '/moderation/reports', 'Moderation', 'staff', 'The report queue', { permission: 'moderate' }),
  e('GET', '/moderation/reports/{reportId}', 'Moderation', 'staff', 'Look up an exact report and its current state', { permission: 'moderate' }),
  e('GET', '/moderation/reports/{reportId}/assignment-history', 'Moderation', 'staff', 'Read the recorded case ownership transitions', { permission: 'moderate' }),
  e('POST', '/moderation/reports/{reportId}/assign', 'Moderation', 'staff', 'Assign, release or reassign an open rider report with a required note', { permission: 'moderate', reauth: true }),
  e('GET', '/moderation/actions', 'Moderation', 'staff', 'The audit log', { permission: 'view_audit' }),
  e('POST', '/moderation/reports/{reportId}/resolve', 'Moderation', 'staff', 'Dismiss a report or suspend the rider', { permission: 'moderate', reauth: true }),
  e('POST', '/moderation/reports/dismiss-many', 'Moderation', 'staff', 'Dismiss up to 50 open reports with one note, each audited on its own', { permission: 'moderate', reauth: true }),
  e('POST', '/moderation/reports/{reportId}/claim', 'Moderation', 'staff', 'Take a report, or let it go ({ release: true })', { permission: 'moderate' }),
  e('POST', '/moderation/riders/{riderId}/suspend', 'Moderation', 'staff', 'Suspend a rider, for some days or with no end', { permission: 'moderate', reauth: true }),
  e('POST', '/moderation/riders/{riderId}/unsuspend', 'Moderation', 'staff', 'Unsuspend a rider', { permission: 'moderate', reauth: true }),
  e('POST', '/moderation/riders/{riderId}/sign-out', 'Moderation', 'staff', 'Sign a rider out on every device', { permission: 'account_help', reauth: true }),
  e('POST', '/moderation/riders/{riderId}/password-reset', 'Moderation', 'staff', 'Email a rider a password reset link', { permission: 'account_help', reauth: true }),
  e('POST', '/moderation/riders/{riderId}/verify-email', 'Moderation', 'staff', 'Mark a rider\'s email verified', { permission: 'verify_email', reauth: true }),
  e('GET', '/moderation/social-posts', 'Moderation', 'staff', 'Hidden Social posts', { permission: 'moderate' }),
  e('GET', '/moderation/social-posts/{postId}', 'Moderation', 'staff', 'Look up an exact hidden Social post', { permission: 'moderate' }),
  e('POST', '/moderation/social-posts/{postId}/restore', 'Moderation', 'staff', 'Restore a hidden post', { permission: 'moderate', reauth: true }),
  e('POST', '/moderation/social-posts/{postId}/remove', 'Moderation', 'staff', 'Remove a hidden post', { permission: 'moderate', reauth: true }),

  e('GET', '/admin/me', 'Staff dashboard', 'staff', 'Your staff role and permissions'),
  e('GET', '/admin/alerts', 'Staff dashboard', 'staff', 'Your own email alert choices'),
  e('POST', '/admin/alerts', 'Staff dashboard', 'staff', 'Turn your morning summary and urgent-case emails on or off'),
  e('GET', '/admin/broadcasts', 'Staff dashboard', 'staff', 'Push notifications sent to riders, and how many riders one would reach now', { permission: 'send_notifications' }),
  e('POST', '/admin/broadcasts', 'Staff dashboard', 'staff', 'Send a push notification to every rider who allows updates, or a test to yourself', { permission: 'send_notifications', reauth: true }),
  e('GET', '/admin/announcements', 'Staff dashboard', 'staff', 'In-app announcements, newest first', { permission: 'send_notifications' }),
  e('POST', '/admin/announcements', 'Staff dashboard', 'staff', 'Schedule an in-app announcement riders see on the map, with a note for the audit log', { permission: 'send_notifications', reauth: true }),
  e('POST', '/admin/announcements/{id}/end', 'Staff dashboard', 'staff', 'Take an in-app announcement down early, with a note for the audit log', { permission: 'send_notifications', reauth: true }),
  e('GET', '/admin/switches', 'Staff dashboard', 'staff', 'Whether sign-ups, Social posting and Nearby Voice are on, and who last changed each', { permission: 'manage_switches' }),
  e('POST', '/admin/switches/{key}', 'Staff dashboard', 'staff', 'Pause or resume sign-ups, Social posting or Nearby Voice for every rider, with a note for the audit log', { permission: 'manage_switches', reauth: true }),
  e('GET', '/admin/content', 'Staff dashboard', 'staff', 'Hazards and rider-made scenic routes, for review', { permission: 'moderate' }),
  e('POST', '/admin/content/{kind}/{id}/remove', 'Staff dashboard', 'staff', 'Remove a hazard or scenic route with a note for the audit log', { permission: 'moderate', reauth: true }),
  e('POST', '/admin/content/routes/{id}/edit', 'Staff dashboard', 'staff', 'Rename or reword a rider-made scenic route, with a note for the audit log', { permission: 'moderate', reauth: true }),
  e('POST', '/admin/content/hazards/{id}/expire', 'Staff dashboard', 'staff', 'Take a hazard off the map now but keep its record, with a note for the audit log', { permission: 'moderate', reauth: true }),
  e('GET', '/admin/overview', 'Staff dashboard', 'staff', 'Business overview', { permission: 'view_overview' }),
  e('GET', '/admin/action-inbox', 'Staff dashboard', 'staff', 'Read the unified pending rider report and hidden Social post queue', { permission: 'moderate' }),
  e('GET', '/admin/social/activity', 'Company operations', 'staff', 'Aggregated Rider Social posting and safety activity for 7 or 30 days, without private content or rider identifiers', { permission: 'moderate' }),
  e('GET', '/admin/cases', 'Company operations', 'staff', 'List case records by permitted workstream with bounded cursor pagination', { permission: 'view_cases' }),
  e('GET', '/admin/cases/summary', 'Company operations', 'staff', 'Role-scoped support, appeal, privacy and incident workload totals', { permission: 'view_cases' }),
  e('GET', '/admin/cases/activity', 'Company operations', 'staff', 'Complete role-scoped internal case event activity for the selected 7 or 30 days, independent of bounded queue samples', { permission: 'view_cases' }),
  e('POST', '/admin/cases', 'Company operations', 'staff', 'Create an internal support, appeal, privacy or incident case (type-restricted)', { permission: 'view_cases', reauth: true }),
  e('GET', '/admin/cases/{caseId}', 'Company operations', 'staff', 'Read an authorised internal case and its attributed history', { permission: 'view_cases' }),
  e('POST', '/admin/cases/{caseId}/notes', 'Company operations', 'staff', 'Append an internal-only case note', { permission: 'view_cases', reauth: true }),
  e('POST', '/admin/cases/{caseId}/assign', 'Company operations', 'staff', 'Claim, release or reassign a case', { permission: 'view_cases', reauth: true }),
  e('POST', '/admin/cases/{caseId}/status', 'Company operations', 'staff', 'Change a case workflow status with reason', { permission: 'view_cases', reauth: true }),
  e('POST', '/admin/cases/{caseId}/priority', 'Company operations', 'staff', 'Change case priority with reason', { permission: 'view_cases', reauth: true }),
  e('POST', '/admin/cases/{caseId}/target', 'Company operations', 'staff', 'Set or clear an internal case follow-up target, with role checks, password re-check, expected version and reason; not a legal deadline or customer SLA', { permission: 'view_cases', reauth: true }),
  e('GET', '/admin/partners', 'Partners', 'staff', 'List seller and advertiser applications by status (open, or one status) and type', { permission: 'review_partners' }),
  e('GET', '/admin/partners/summary', 'Partners', 'staff', 'Applications awaiting review or more information, and approved sellers and advertisers', { permission: 'review_partners' }),
  e('GET', '/admin/partners/{applicationId}', 'Partners', 'staff', 'One application and its history', { permission: 'review_partners' }),
  e('POST', '/admin/partners/{applicationId}/status', 'Partners', 'staff', 'Review, request information, approve (checklist complete) or reject, with a note and expected version', { permission: 'review_partners', reauth: true }),
  e('POST', '/admin/partners/{applicationId}/checklist', 'Partners', 'staff', 'Tick or clear one verification checklist item, with a note', { permission: 'review_partners', reauth: true }),
  e('POST', '/admin/partners/{applicationId}/notes', 'Partners', 'staff', 'Add a note to the application history', { permission: 'review_partners', reauth: true }),
  e('POST', '/admin/partners/{applicationId}/assign', 'Partners', 'staff', 'Take, release or (admins) reassign an application', { permission: 'review_partners', reauth: true }),
  e('GET', '/admin/system', 'Staff dashboard', 'staff', 'What the backend is set up to do', { permission: 'view_system' }),
  e('GET', '/admin/metrics', 'Staff dashboard', 'staff', 'Last hour of requests on this replica', { permission: 'view_system' }),
  e('GET', '/admin/riders', 'Staff dashboard', 'staff', 'Find riders', { permission: 'view_riders' }),
  e('GET', '/admin/riders/{riderId}', 'Staff dashboard', 'staff', 'One rider: account, reports, staff history, devices and sign-ins as the role allows', { permission: 'view_riders' }),
  e('POST', '/admin/riders/{riderId}/export', 'Staff dashboard', 'staff', 'Export a rider\'s data for an access request', { permission: 'manage_staff', reauth: true }),
  e('GET', '/admin/security-events', 'Staff dashboard', 'staff', 'Account security history', { permission: 'manage_staff' }),
  e('GET', '/admin/staff', 'Staff dashboard', 'staff', 'Staff and their roles', { permission: 'manage_staff' }),
  e('POST', '/admin/staff', 'Staff dashboard', 'staff', 'Give or change a staff role', { permission: 'manage_staff', reauth: true }),
  e('POST', '/admin/staff/{riderId}/remove', 'Staff dashboard', 'staff', 'Remove a staff role', { permission: 'manage_staff', reauth: true }),
];

const ACCESS_NOTES: Record<Access, string> = {
  public: 'No sign-in needed.',
  rider: 'Signed in.',
  staff: 'Signed in staff.',
};

/** Posting content, joining voice and reporting need a verified email (server.ts). */
export function requiresVerifiedEmail(method: string | undefined, pathname: string): boolean {
  if (method !== 'POST') return false;
  if ([
    '/presence',
    '/voice/token',
    '/reports',
    '/friends/requests',
    '/messages',
    '/hideouts',
    '/hazards',
    '/scenic-routes',
    '/social/media',
    '/social/posts',
  ].includes(pathname)) return true;
  return /^\/hazards\/[^/]+\/(confirm|deny)$/.test(pathname) || /^\/social\/posts\/[^/]+\/report$/.test(pathname);
}


/** API version prefix: /v1/rides is /rides. */
export const API_VERSION_PREFIX = '/v1';
export function apiPath(pathname: string): string {
  if (pathname === API_VERSION_PREFIX) return '/';
  return pathname.startsWith(`${API_VERSION_PREFIX}/`) ? pathname.slice(API_VERSION_PREFIX.length) : pathname;
}


/** An OpenAPI 3.1 description of API_ENDPOINTS. */
export function openApiDocument(serverUrl?: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of API_ENDPOINTS) {
    const parameters = [...endpoint.path.matchAll(/\{([A-Za-z]+)\}/g)].map((match) => ({ name: match[1], in: 'path', required: true, schema: { type: 'string' } }));
    const verified = requiresVerifiedEmail(endpoint.method, endpoint.path.replace(/\{[A-Za-z]+\}/g, 'x'));
    const notes = [verified ? 'Signed in with a verified email.' : ACCESS_NOTES[endpoint.access]];
    if (endpoint.permission) notes.push(`Needs the \`${endpoint.permission}\` permission.`);
    if (endpoint.reauth) notes.push('Needs the password re-entered within 15 minutes (POST /auth/reauthenticate); otherwise 403 `reauth_required`.');
    const responses: Record<string, unknown> = { 200: { description: 'OK' } };
    if (endpoint.access !== 'public') responses[401] = { description: 'Not signed in' };
    if (verified) responses[403] = { description: 'Email not verified, or the current Terms not accepted' };
    if (endpoint.access === 'staff') responses[403] = { description: 'Not staff, missing the permission, or a password re-check is needed' };
    responses[429] = { description: 'Rate limited' };
    paths[endpoint.path] = {
      ...paths[endpoint.path],
      [endpoint.method.toLowerCase()]: {
        summary: endpoint.summary,
        description: notes.join(' '),
        tags: [endpoint.tag],
        ...(parameters.length ? { parameters } : {}),
        ...(endpoint.access === 'public' ? { security: [] } : {}),
        ...(endpoint.permission ? { 'x-permission': endpoint.permission } : {}),
        responses,
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Rider Comms API',
      version: '1',
      description: 'The backend for Rider Comms and Rider Social. Every path also answers under /v1. Errors are JSON: { "error": "<code>" }. Each response carries an X-Request-Id to quote when reporting a problem.',
    },
    ...(serverUrl ? { servers: [{ url: serverUrl }, { url: `${serverUrl.replace(/\/$/, '')}/v1` }] } : {}),
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearer: [] }],
    paths,
  };
}
