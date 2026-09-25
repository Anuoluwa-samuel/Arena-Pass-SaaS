/**
 * Domain constants shared by client and server.
 *
 * Business rules live here as data, not as magic numbers scattered through
 * components and services. Defaults are used when an arena does not override
 * them; the hard limits are what the database CHECK constraints enforce.
 */

export const SESSION_DEFAULTS = {
  teamsCount: 8,
  playersPerTeam: 4,
} as const

export const SESSION_LIMITS = {
  minTeams: 2,
  maxTeams: 8,
  minPlayersPerTeam: 1,
  maxPlayersPerTeam: 4,
} as const

export function computeCapacity(teamsCount: number, playersPerTeam: number) {
  return teamsCount * playersPerTeam
}

/** How long a pending booking holds a slot before it is released. */
export const BOOKING_HOLD_MINUTES = 10

export const SESSION_STATUS = [
  "DRAFT",
  "PUBLISHED",
  "OPEN_FOR_BOOKING",
  "FULL",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const
export type SessionStatus = (typeof SESSION_STATUS)[number]

export const BOOKING_STATUS = ["PENDING", "CONFIRMED", "CANCELLED", "EXPIRED"] as const
export type BookingStatus = (typeof BOOKING_STATUS)[number]

export const TICKET_STATUS = [
  "PENDING",
  "CONFIRMED",
  "USED",
  "CANCELLED",
  "REFUNDED",
  "EXPIRED",
] as const
export type TicketStatus = (typeof TICKET_STATUS)[number]

export const PAYMENT_STATUS = ["PENDING", "PAID", "FAILED", "REFUNDED"] as const
export type PaymentStatus = (typeof PAYMENT_STATUS)[number]

export const TICKET_TYPE = ["STANDARD"] as const
export type TicketType = (typeof TICKET_TYPE)[number]

export const TRANSACTION_TYPE = ["CHARGE", "REFUND"] as const
export type TransactionType = (typeof TRANSACTION_TYPE)[number]

/**
 * Roles come in two scopes. A PLATFORM role governs the Game Slots platform
 * itself and is held through `users.platform_role_id`; an ARENA role governs
 * one tenant and is held through an `arena_memberships` row. A role is never
 * both, so a platform operator cannot silently inherit tenant access and a
 * tenant role cannot reach platform surfaces.
 */
export const PLATFORM_ROLE_KEYS = ["PLATFORM_OWNER", "PLATFORM_ADMIN", "PLATFORM_SUPPORT"] as const
export type PlatformRoleKey = (typeof PLATFORM_ROLE_KEYS)[number]

export const ARENA_ROLE_KEYS = ["ARENA_OWNER", "ARENA_ADMIN", "MANAGER", "FINANCE", "TICKET_AGENT", "STAFF"] as const
export type ArenaRoleKey = (typeof ARENA_ROLE_KEYS)[number]

export const ROLE_KEYS = [...PLATFORM_ROLE_KEYS, ...ARENA_ROLE_KEYS] as const
export type RoleKey = (typeof ROLE_KEYS)[number]

export const ROLE_SCOPES = ["PLATFORM", "ARENA"] as const
export type RoleScope = (typeof ROLE_SCOPES)[number]

export function roleScopeOf(key: RoleKey): RoleScope {
  return (PLATFORM_ROLE_KEYS as readonly string[]).includes(key) ? "PLATFORM" : "ARENA"
}

export function isPlatformRole(key: string): key is PlatformRoleKey {
  return (PLATFORM_ROLE_KEYS as readonly string[]).includes(key)
}

export function isArenaRole(key: string): key is ArenaRoleKey {
  return (ARENA_ROLE_KEYS as readonly string[]).includes(key)
}

/**
 * Pre-multi-tenancy role keys and what they become. The 0005 data migration
 * renames the rows; this map is also what `ensureBaseline` uses so a database
 * that predates the migration converges on the same vocabulary.
 */
export const LEGACY_ROLE_KEY_MAP: Record<string, RoleKey> = {
  SUPER_ADMIN: "PLATFORM_OWNER",
  ADMIN: "ARENA_ADMIN",
}

/** Membership lifecycle. Only ACTIVE grants access. */
export const MEMBERSHIP_STATUS = ["INVITED", "ACTIVE", "SUSPENDED", "REMOVED"] as const
export type MembershipStatus = (typeof MEMBERSHIP_STATUS)[number]

/** An arena is only reachable by customers when ACTIVE. */
export const ARENA_STATUS = ["PENDING_SETUP", "ACTIVE", "SUSPENDED", "ARCHIVED"] as const
export type ArenaStatus = (typeof ARENA_STATUS)[number]

export const ORGANIZATION_STATUS = ["PENDING_SETUP", "ACTIVE", "SUSPENDED", "ARCHIVED"] as const
export type OrganizationStatus = (typeof ORGANIZATION_STATUS)[number]

/** A hostname only resolves to its arena once VERIFIED. */
export const DOMAIN_STATUS = ["PENDING", "VERIFIED", "FAILED", "DISABLED"] as const
export type DomainStatus = (typeof DOMAIN_STATUS)[number]

export const PAYMENT_ACCOUNT_STATUS = ["PENDING", "ACTIVE", "DISABLED"] as const
export type PaymentAccountStatus = (typeof PAYMENT_ACCOUNT_STATUS)[number]

/**
 * The SaaS subscription an organization holds with Game Slots.
 *
 * Deliberately a separate vocabulary from `PAYMENT_STATUS`: an arena's
 * customers paying for football and an arena paying for Game Slots are
 * different financial domains that must never share a code path.
 */
export const SUBSCRIPTION_STATUS = ["TRIALING", "ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED"] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[number]

export const BILLING_INTERVAL = ["MONTHLY", "YEARLY"] as const
export type BillingInterval = (typeof BILLING_INTERVAL)[number]

/** What an organization is billed on. */
export const USAGE_METRIC = ["ARENAS", "SESSIONS", "TICKETS", "STAFF"] as const
export type UsageMetric = (typeof USAGE_METRIC)[number]

/**
 * Capabilities that can be turned on per arena. Checked on the server for
 * anything that matters — hiding a button is not a feature gate.
 */
export const FEATURE_FLAGS = [
  "custom_domains",
  "multiple_locations",
  "advanced_analytics",
  "waitlists",
  "team_management",
] as const
export type FeatureFlag = (typeof FEATURE_FLAGS)[number]

/** Resumable onboarding. The arena stays PENDING_SETUP until `launched`. */
export const ONBOARDING_STEPS = [
  "organization",
  "arena",
  "branding",
  "payments",
  "first_session",
  "staff",
  "launched",
] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

/**
 * Permission vocabulary. Route handlers call requirePermission(...) with one
 * of these; the role→permission mapping is stored in the database and seeded
 * from DEFAULT_ROLE_PERMISSIONS.
 */
export const PERMISSIONS = [
  "dashboard.view",
  "sessions.view",
  "sessions.manage",
  "tickets.view",
  "tickets.manage",
  "tickets.validate",
  "tickets.refund",
  "customers.view",
  "customers.manage",
  "payments.view",
  "payments.manage",
  "analytics.view",
  "cms.view",
  "cms.manage",
  "media.view",
  "media.manage",
  "notifications.view",
  "notifications.manage",
  "settings.view",
  "settings.manage",
  "audit.view",
  // Staff management inside one arena.
  "staff.view",
  "staff.invite",
  "staff.update",
  "staff.remove",
  // Platform surfaces. These are only ever granted to a PLATFORM role and are
  // never checked against an arena membership.
  "platform.overview.view",
  "platform.organizations.view",
  "platform.organizations.manage",
  "platform.arenas.view",
  "platform.arenas.manage",
  "platform.users.view",
  "platform.users.manage",
  "platform.subscriptions.view",
  "platform.subscriptions.manage",
  "platform.audit.view",
  "platform.impersonate",
  "platform.settings.manage",
  /**
   * Roles are a platform-wide catalogue shared by every arena, so editing one
   * changes what MANAGER means everywhere. That can never be an arena
   * permission: an arena owner would be able to widen their own staff's access
   * inside every other tenant.
   */
  "platform.roles.manage",
] as const
export type Permission = (typeof PERMISSIONS)[number]

/** Permissions that only make sense at platform level. */
export const PLATFORM_PERMISSIONS = PERMISSIONS.filter((p) => p.startsWith("platform.")) as readonly Permission[]

/** Permissions that are always evaluated against a specific arena. */
export const ARENA_PERMISSIONS = PERMISSIONS.filter((p) => !p.startsWith("platform.")) as readonly Permission[]

export function isPlatformPermission(permission: Permission) {
  return permission.startsWith("platform.")
}

const ARENA_ADMIN_PERMISSIONS = ARENA_PERMISSIONS.filter((p) => p !== "settings.manage")

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  // Platform roles ------------------------------------------------------
  PLATFORM_OWNER: PERMISSIONS,
  PLATFORM_ADMIN: PLATFORM_PERMISSIONS.filter((p) => p !== "platform.settings.manage"),
  PLATFORM_SUPPORT: [
    "platform.overview.view",
    "platform.organizations.view",
    "platform.arenas.view",
    "platform.users.view",
    "platform.subscriptions.view",
    "platform.audit.view",
  ],
  // Arena roles ---------------------------------------------------------
  ARENA_OWNER: ARENA_PERMISSIONS,
  ARENA_ADMIN: ARENA_ADMIN_PERMISSIONS,
  MANAGER: [
    "dashboard.view",
    "sessions.view",
    "sessions.manage",
    "tickets.view",
    "tickets.manage",
    "tickets.validate",
    "customers.view",
    "customers.manage",
    "payments.view",
    "analytics.view",
    "notifications.view",
    "audit.view",
    "staff.view",
  ],
  FINANCE: [
    "dashboard.view",
    "payments.view",
    "payments.manage",
    "tickets.view",
    "tickets.refund",
    "analytics.view",
    "audit.view",
  ],
  STAFF: ["dashboard.view", "sessions.view", "tickets.view", "tickets.validate"],
  TICKET_AGENT: [
    "dashboard.view",
    "sessions.view",
    "tickets.view",
    "tickets.manage",
    "customers.view",
    "customers.manage",
  ],
}

export const ROLE_LABELS: Record<RoleKey, string> = {
  PLATFORM_OWNER: "Platform Owner",
  PLATFORM_ADMIN: "Platform Admin",
  PLATFORM_SUPPORT: "Platform Support",
  ARENA_OWNER: "Arena Owner",
  ARENA_ADMIN: "Arena Administrator",
  MANAGER: "Manager",
  FINANCE: "Finance",
  TICKET_AGENT: "Ticket Agent",
  STAFF: "Staff",
}

export const NOTIFICATION_CHANNEL = ["EMAIL", "SMS", "IN_APP", "PUSH"] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[number]

export const NOTIFICATION_STATUS = ["PENDING", "SENT", "FAILED", "READ"] as const

export const CMS_PAGE_SLUGS = ["homepage", "about", "services", "contact"] as const
export type CmsPageSlug = (typeof CMS_PAGE_SLUGS)[number]

export const ANNOUNCEMENT_STATUS = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const

export const DEFAULT_CURRENCY = "NGN"

/** Error codes returned by the API. Stable strings clients can switch on. */
export const ERROR_CODES = [
  "SESSION_NOT_FOUND",
  "SESSION_FULL",
  "SESSION_NOT_BOOKABLE",
  "BOOKING_CLOSED",
  "BOOKING_NOT_OPEN",
  "BOOKING_NOT_FOUND",
  "BOOKING_EXPIRED",
  "BOOKING_ALREADY_CONFIRMED",
  "DUPLICATE_BOOKING",
  "INVALID_TICKET",
  "TICKET_NOT_FOUND",
  "TICKET_ALREADY_USED",
  "TICKET_NOT_VALID",
  "TICKET_WRONG_SESSION",
  "PAYMENT_FAILED",
  "PAYMENT_PENDING",
  "PAYMENT_NOT_FOUND",
  "PAYMENT_PROVIDER_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "ARENA_NOT_FOUND",
  "ARENA_UNAVAILABLE",
  "ARENA_SELECTION_REQUIRED",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INVALID_CREDENTIALS",
  "ACCOUNT_DISABLED",
  "EMAIL_TAKEN",
  "INVALID_RESET_TOKEN",
  "OAUTH_FAILED",
  "INTERNAL_ERROR",
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]
