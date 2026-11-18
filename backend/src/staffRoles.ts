/**
 * Staff roles for the dashboard. Least privilege: a rider has no staff
 * access until a role is granted, and each role carries only what that job
 * needs. Admins come from ADMIN_RIDER_IDS (users.is_admin) and are the only
 * people who can grant or remove the other roles; granting admin itself
 * stays a deployment decision.
 */
export const STAFF_ROLES = ['admin', 'moderator', 'support', 'analyst'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles an admin can grant from the dashboard. */
export const GRANTABLE_STAFF_ROLES = ['moderator', 'support', 'analyst'] as const;
export type GrantableStaffRole = (typeof GRANTABLE_STAFF_ROLES)[number];

export const STAFF_PERMISSIONS = [
  'view_overview',
  'view_system',
  'view_riders',
  'moderate',
  'verify_email',
  'view_audit',
  'manage_staff',
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<StaffRole, readonly StaffPermission[]> = {
  admin: STAFF_PERMISSIONS,
  // Reports, hidden posts, suspensions; looks riders up and reads the log.
  moderator: ['view_overview', 'view_system', 'view_riders', 'moderate', 'view_audit'],
  // Account help: looks riders up and verifies email, but cannot suspend.
  support: ['view_overview', 'view_system', 'view_riders', 'verify_email', 'view_audit'],
  // Numbers only: no rider details, reports or notes.
  analyst: ['view_overview', 'view_system'],
};

export function permissionsFor(role: StaffRole | null): StaffPermission[] {
  return role ? [...ROLE_PERMISSIONS[role]] : [];
}

export function roleCan(role: StaffRole | null, permission: StaffPermission): boolean {
  return role !== null && ROLE_PERMISSIONS[role].includes(permission);
}

export function isGrantableStaffRole(value: unknown): value is GrantableStaffRole {
  return typeof value === 'string' && (GRANTABLE_STAFF_ROLES as readonly string[]).includes(value);
}
