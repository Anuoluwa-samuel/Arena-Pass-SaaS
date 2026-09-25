import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import {
  ANNOUNCEMENT_STATUS,
  ARENA_STATUS,
  BILLING_INTERVAL,
  BOOKING_STATUS,
  CMS_PAGE_SLUGS,
  DOMAIN_STATUS,
  MEMBERSHIP_STATUS,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_STATUS,
  ONBOARDING_STEPS,
  ORGANIZATION_STATUS,
  PAYMENT_ACCOUNT_STATUS,
  PAYMENT_STATUS,
  ROLE_KEYS,
  SUBSCRIPTION_STATUS,
  USAGE_METRIC,
  ROLE_SCOPES,
  type RoleKey,
  SESSION_STATUS,
  TICKET_STATUS,
  TICKET_TYPE,
  TRANSACTION_TYPE,
} from "@/lib/domain/constants"

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const sessionStatusEnum = pgEnum("session_status", SESSION_STATUS)
export const bookingStatusEnum = pgEnum("booking_status", BOOKING_STATUS)
export const ticketStatusEnum = pgEnum("ticket_status", TICKET_STATUS)
export const ticketTypeEnum = pgEnum("ticket_type", TICKET_TYPE)
export const paymentStatusEnum = pgEnum("payment_status", PAYMENT_STATUS)
export const transactionTypeEnum = pgEnum("transaction_type", TRANSACTION_TYPE)
export const roleScopeEnum = pgEnum("role_scope", ROLE_SCOPES)
export const organizationStatusEnum = pgEnum("organization_status", ORGANIZATION_STATUS)
export const arenaStatusEnum = pgEnum("arena_status", ARENA_STATUS)
export const membershipStatusEnum = pgEnum("membership_status", MEMBERSHIP_STATUS)
export const domainStatusEnum = pgEnum("domain_status", DOMAIN_STATUS)
export const paymentAccountStatusEnum = pgEnum("payment_account_status", PAYMENT_ACCOUNT_STATUS)
export const onboardingStepEnum = pgEnum("onboarding_step", ONBOARDING_STEPS)
export const subscriptionStatusEnum = pgEnum("subscription_status", SUBSCRIPTION_STATUS)
export const billingIntervalEnum = pgEnum("billing_interval", BILLING_INTERVAL)
export const usageMetricEnum = pgEnum("usage_metric", USAGE_METRIC)
export const notificationChannelEnum = pgEnum("notification_channel", NOTIFICATION_CHANNEL)
export const notificationStatusEnum = pgEnum("notification_status", NOTIFICATION_STATUS)
export const cmsPageSlugEnum = pgEnum("cms_page_slug", CMS_PAGE_SLUGS)
export const announcementStatusEnum = pgEnum("announcement_status", ANNOUNCEMENT_STATUS)
export const principalTypeEnum = pgEnum("principal_type", ["user", "customer", "system"])
export const slotStatusEnum = pgEnum("slot_status", ["FREE", "HELD", "CONFIRMED"])

export const ticketNumberSeq = pgSequence("ticket_number_seq", { startWith: 1 })

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}

// ---------------------------------------------------------------------------
// Organizations (billing owner) → Arenas (the tenant boundary)
// ---------------------------------------------------------------------------

/**
 * The commercial entity that signs up for Arena Pass and owns the
 * subscription. One organization may own several arenas; today the product
 * creates one arena per organization, but nothing in the schema assumes it.
 */
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  billingEmail: text("billing_email"),
  country: text("country").notNull().default("NG"),
  status: organizationStatusEnum("status").notNull().default("PENDING_SETUP"),
  createdByUserId: uuid("created_by_user_id"),
  ...timestamps,
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
})

/**
 * THE TENANT BOUNDARY. Every tenant-owned row in this schema carries an
 * `arena_id` that points here, and no request may read or write a row whose
 * arena_id differs from the one resolved from the caller's membership.
 */
export const arenas = pgTable(
  "arenas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    /** Globally unique: it is the tenant's subdomain (`{slug}.arenapass.com`). */
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    addressLine: text("address_line"),
    city: text("city"),
    country: text("country").default("NG"),
    timezone: text("timezone").notNull().default("Africa/Lagos"),
    currency: text("currency").notNull().default("NGN"),
    status: arenaStatusEnum("status").notNull().default("PENDING_SETUP"),
    // Branding. Operational tunables live in `system_settings`; these are the
    // tenant's public identity and are rendered on its storefront.
    logoMediaId: uuid("logo_media_id"),
    brandPrimaryColor: text("brand_primary_color"),
    brandAccentColor: text("brand_accent_color"),
    /** Resumable onboarding: the next step the owner has to complete. */
    onboardingStep: onboardingStepEnum("onboarding_step").notNull().default("organization"),
    launchedAt: timestamp("launched_at", { withTimezone: true }),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("arenas_organization_idx").on(t.organizationId),
    index("arenas_status_idx").on(t.status),
    // `(id, …)` targets exist so child tables can carry a composite foreign key
    // on (arena_id, id) and make a cross-tenant row unrepresentable.
    uniqueIndex("arenas_id_key").on(t.id),
  ]
)

/**
 * Hostnames that resolve to an arena. A row only participates in tenant
 * resolution once `status = 'VERIFIED'`, so an attacker cannot claim a
 * hostname by inserting an unverified record.
 */
export const arenaDomains = pgTable(
  "arena_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "cascade" }),
    /** Stored lowercase, host only — never a scheme, port or path. */
    hostname: text("hostname").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    status: domainStatusEnum("status").notNull().default("PENDING"),
    verificationToken: text("verification_token"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("arena_domains_hostname_idx").on(sql`lower(${t.hostname})`),
    index("arena_domains_arena_idx").on(t.arenaId, t.status),
  ]
)

/**
 * Per-arena payment provider credentials. Each tenant is paid into its own
 * account; secrets are stored encrypted and never leave the server.
 */
export const arenaPaymentAccounts = pgTable(
  "arena_payment_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    /** Encrypted at rest; only the payments service decrypts it. */
    secretKeyEncrypted: text("secret_key_encrypted"),
    publicKey: text("public_key"),
    /** Encrypted webhook signing secret for this arena's provider account. */
    webhookSecretEncrypted: text("webhook_secret_encrypted"),
    /** Non-secret provider account identifier, safe to display. */
    providerAccountId: text("provider_account_id"),
    status: paymentAccountStatusEnum("status").notNull().default("PENDING"),
    isDefault: boolean("is_default").notNull().default(false),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("arena_payment_accounts_arena_provider_idx").on(t.arenaId, t.provider),
    index("arena_payment_accounts_status_idx").on(t.arenaId, t.status),
  ]
)

// ---------------------------------------------------------------------------
// Billing — what an organization pays Arena Pass
//
// Entirely separate from `payments`, which is what an arena's customers pay
// the arena. Two financial domains, two vocabularies, no shared code path: a
// bug in football ticketing must not be able to touch a subscription, and a
// failed subscription charge must never look like a failed booking.
// ---------------------------------------------------------------------------

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    /** Minor units, like every other amount in this schema. */
    priceMinor: integer("price_minor").notNull().default(0),
    currency: text("currency").notNull().default("NGN"),
    interval: billingIntervalEnum("interval").notNull().default("MONTHLY"),
    /** Null means unlimited. */
    maxArenas: integer("max_arenas"),
    maxSessionsPerMonth: integer("max_sessions_per_month"),
    maxStaff: integer("max_staff"),
    isPublic: boolean("is_public").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [check("plans_price_nonnegative", sql`${t.priceMinor} >= 0`)]
)

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    status: subscriptionStatusEnum("status").notNull().default("TRIALING"),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    /** The provider reference for the *subscription*, never a booking payment. */
    providerReference: text("provider_reference"),
    ...timestamps,
  },
  (t) => [
    // One live subscription per organization; history lives in the events table.
    uniqueIndex("subscriptions_organization_idx").on(t.organizationId),
    index("subscriptions_status_period_idx").on(t.status, t.currentPeriodEnd),
  ]
)

/** Append-only history of everything that happened to a subscription. */
export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    fromStatus: subscriptionStatusEnum("from_status"),
    toStatus: subscriptionStatusEnum("to_status"),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("subscription_events_subscription_idx").on(t.subscriptionId, t.createdAt)]
)

/** What an organization actually used in a period, for billing and for limits. */
export const usageRecords = pgTable(
  "usage_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    arenaId: uuid("arena_id").references(() => arenas.id, { onDelete: "set null" }),
    metric: usageMetricEnum("metric").notNull(),
    quantity: integer("quantity").notNull().default(0),
    /** First day of the period this count belongs to. */
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("usage_records_scope_idx").on(t.organizationId, t.metric, t.periodStart, sql`coalesce(${t.arenaId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    index("usage_records_org_period_idx").on(t.organizationId, t.periodStart),
  ]
)

// ---------------------------------------------------------------------------
// Feature flags
// ---------------------------------------------------------------------------

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  description: text("description").notNull(),
  /** Applies to every arena that has no explicit override. */
  defaultEnabled: boolean("default_enabled").notNull().default(false),
  ...timestamps,
})

export const arenaFeatureFlags = pgTable(
  "arena_feature_flags",
  {
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "cascade" }),
    flagKey: text("flag_key")
      .notNull()
      .references(() => featureFlags.key, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.arenaId, t.flagKey] })]
)

// ---------------------------------------------------------------------------
// Impersonation
// ---------------------------------------------------------------------------

/**
 * A platform operator temporarily looking inside one arena.
 *
 * A platform role grants no tenant access on its own; this is the only way
 * across that line, and it is deliberately awkward: it must be started
 * explicitly, it names a reason, it expires on its own, and every grant it
 * produces is read-only. The row is the audit trail.
 */
export const impersonations = pgTable(
  "impersonations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
  },
  (t) => [
    index("impersonations_user_active_idx").on(t.userId, t.endedAt, t.expiresAt),
    index("impersonations_arena_idx").on(t.arenaId, t.startedAt),
  ]
)

// ---------------------------------------------------------------------------
// RBAC
// ---------------------------------------------------------------------------

/**
 * System role catalogue. `scope` decides how a role may be held: a PLATFORM
 * role through `users.platform_role_id`, an ARENA role through an
 * `arena_memberships` row. The key is text rather than an enum so the
 * vocabulary can grow without an `ALTER TYPE` in a migration transaction.
 */
export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").$type<RoleKey>().notNull().unique(),
    scope: roleScopeEnum("scope").notNull().default("ARENA"),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check("roles_key_known", sql.raw(`key in (${ROLE_KEYS.map((k) => `'${k}'`).join(", ")})`)),
    index("roles_scope_idx").on(t.scope),
  ]
)

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })]
)

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Non-null only for Arena Pass staff. Must reference a PLATFORM-scoped role. */
    platformRoleId: uuid("platform_role_id").references(() => roles.id, { onDelete: "restrict" }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)]
)

/**
 * The link between an identity and a tenant, and the only thing that grants a
 * user access to an arena. Authorisation never infers the arena from an email
 * address, a URL slug or a request body: it looks for an ACTIVE row here.
 * One user may hold memberships in several arenas with different roles.
 */
export const arenaMemberships = pgTable(
  "arena_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    status: membershipStatusEnum("status").notNull().default("ACTIVE"),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // One membership per (arena, user): a role change updates this row.
    uniqueIndex("arena_memberships_arena_user_idx").on(t.arenaId, t.userId),
    // The hot path: "which arenas may this user act in?"
    index("arena_memberships_user_status_idx").on(t.userId, t.status),
    index("arena_memberships_arena_status_idx").on(t.arenaId, t.status),
  ]
)

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    /** Null for guest checkout and Google-only accounts; set when the customer chooses a password. */
    passwordHash: text("password_hash"),
    /** Google's stable account id (`sub`). Linked on first Google sign-in; survives email changes. */
    googleSub: text("google_sub"),
    // Self-service profile (all optional). Allowed values live in lib/domain/profile.ts.
    /** Public handle, stored lowercase; unique case-insensitively. */
    username: text("username"),
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    gender: text("gender"),
    city: text("city"),
    preferredPosition: text("preferred_position"),
    skillLevel: text("skill_level"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Per-arena, not global: the same person may hold an account at several
    // arenas, and each storefront's handles are its own.
    uniqueIndex("customers_arena_email_idx").on(t.arenaId, sql`lower(${t.email})`),
    uniqueIndex("customers_arena_username_idx").on(t.arenaId, sql`lower(${t.username})`),
    uniqueIndex("customers_arena_google_sub_idx").on(t.arenaId, t.googleSub),
    uniqueIndex("customers_arena_id_key").on(t.arenaId, t.id),
    index("customers_arena_created_idx").on(t.arenaId, t.createdAt),
  ]
)

/** Server-side sessions for both admin users and customers. */
export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    principalType: principalTypeEnum("principal_type").notNull(),
    principalId: uuid("principal_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_sessions_principal_idx").on(t.principalType, t.principalId)]
)

/** Single-use customer password reset links. Only the SHA-256 of the token is stored. */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("password_reset_tokens_customer_idx").on(t.customerId)]
)

/**
 * Single-use email verification links. Only the SHA-256 of the token is
 * stored, so a database copy cannot be used to verify anyone's address.
 *
 * Deliberately a separate table from `password_reset_tokens` rather than one
 * table with a `purpose` column: the two have different lifetimes and
 * different consequences, and keeping them apart means a bug in one cannot
 * mint a token for the other.
 */
export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    /** The address this token was issued for; a later change invalidates it. */
    email: text("email").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("email_verification_customer_idx").on(t.customerId),
    foreignKey({
      columns: [t.arenaId, t.customerId],
      foreignColumns: [customers.arenaId, customers.id],
      name: "email_verification_arena_customer_fk",
    }).onDelete("cascade"),
  ]
)

// ---------------------------------------------------------------------------
// Football sessions, teams, slots
// ---------------------------------------------------------------------------
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    venue: text("venue").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    bookingOpensAt: timestamp("booking_opens_at", { withTimezone: true }).notNull(),
    bookingDeadline: timestamp("booking_deadline", { withTimezone: true }).notNull(),
    teamsCount: integer("teams_count").notNull().default(8),
    playersPerTeam: integer("players_per_team").notNull().default(4),
    totalCapacity: integer("total_capacity").notNull().default(32),
    /** Confirmed (paid) players. */
    bookedCount: integer("booked_count").notNull().default(0),
    /** Pending reservations awaiting payment. */
    heldCount: integer("held_count").notNull().default(0),
    /** Minor units (kobo / cents). */
    ticketPrice: integer("ticket_price").notNull(),
    currency: text("currency").notNull().default("NGN"),
    status: sessionStatusEnum("status").notNull().default("DRAFT"),
    coverMediaId: uuid("cover_media_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("sessions_arena_starts_idx").on(t.arenaId, t.startsAt),
    index("sessions_status_idx").on(t.status),
    check("sessions_capacity_matches", sql`${t.totalCapacity} = ${t.teamsCount} * ${t.playersPerTeam}`),
    check("sessions_teams_range", sql`${t.teamsCount} between 1 and 8`),
    check("sessions_players_range", sql`${t.playersPerTeam} between 1 and 4`),
    check("sessions_counts_nonnegative", sql`${t.bookedCount} >= 0 and ${t.heldCount} >= 0`),
    check("sessions_not_oversold", sql`${t.bookedCount} + ${t.heldCount} <= ${t.totalCapacity}`),
    check("sessions_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check("sessions_booking_window", sql`${t.bookingDeadline} > ${t.bookingOpensAt}`),
    check("sessions_price_nonnegative", sql`${t.ticketPrice} >= 0`),
    // Composite target: children carry (arena_id, session_id) so a booking in
    // one arena cannot point at a session in another.
    uniqueIndex("sessions_arena_id_key").on(t.arenaId, t.id),
  ]
)

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Denormalised from the parent session so every query can filter on it directly. */
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    teamNumber: integer("team_number").notNull(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("teams_session_number_idx").on(t.sessionId, t.teamNumber),
    check("teams_number_range", sql`${t.teamNumber} between 1 and 8`),
    uniqueIndex("teams_arena_id_key").on(t.arenaId, t.id),
    foreignKey({ columns: [t.arenaId, t.sessionId], foreignColumns: [sessions.arenaId, sessions.id], name: "teams_arena_session_fk" }).onDelete("cascade"),
  ]
)

/**
 * Pre-generated player slots. One row per (session, team, slot). A booking
 * claims a slot by setting booking_id; the unique index guarantees a slot
 * can never be double-allocated, and the row count bounds the session.
 */
export const sessionSlots = pgTable(
  "session_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Denormalised from the parent session so every query can filter on it directly. */
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    teamNumber: integer("team_number").notNull(),
    slotNumber: integer("slot_number").notNull(),
    status: slotStatusEnum("status").notNull().default("FREE"),
    bookingId: uuid("booking_id"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("session_slots_position_idx").on(t.sessionId, t.teamNumber, t.slotNumber),
    uniqueIndex("session_slots_booking_idx").on(t.bookingId),
    index("session_slots_free_idx").on(t.sessionId, t.status),
    check("session_slots_number_range", sql`${t.slotNumber} between 1 and 4`),
    check(
      "session_slots_booking_consistency",
      sql`(${t.status} = 'FREE' and ${t.bookingId} is null) or (${t.status} <> 'FREE' and ${t.bookingId} is not null)`
    ),
    uniqueIndex("session_slots_arena_id_key").on(t.arenaId, t.id),
    foreignKey({ columns: [t.arenaId, t.sessionId], foreignColumns: [sessions.arenaId, sessions.id], name: "session_slots_arena_session_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.arenaId, t.teamId], foreignColumns: [teams.arenaId, teams.id], name: "session_slots_arena_team_fk" }).onDelete("cascade"),
  ]
)

// ---------------------------------------------------------------------------
// Bookings, tickets, payments
// ---------------------------------------------------------------------------
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    slotId: uuid("slot_id").references(() => sessionSlots.id, { onDelete: "set null" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    /** Name of the player who will attend (may differ from the paying customer). */
    playerName: text("player_name").notNull(),
    status: bookingStatusEnum("status").notNull().default("PENDING"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    // Idempotency keys are the customer's, so they are unique *within* an
    // arena: two arenas choosing the same key is not a replay.
    uniqueIndex("bookings_arena_idempotency_idx").on(t.arenaId, t.idempotencyKey),
    uniqueIndex("bookings_arena_id_key").on(t.arenaId, t.id),
    index("bookings_arena_session_status_idx").on(t.arenaId, t.sessionId, t.status),
    index("bookings_arena_customer_idx").on(t.arenaId, t.customerId),
    index("bookings_arena_created_idx").on(t.arenaId, t.createdAt),
    // The hold sweep runs across arenas, so this one leads with status.
    index("bookings_expires_idx").on(t.status, t.expiresAt),
    foreignKey({ columns: [t.arenaId, t.sessionId], foreignColumns: [sessions.arenaId, sessions.id], name: "bookings_arena_session_fk" }),
    foreignKey({ columns: [t.arenaId, t.customerId], foreignColumns: [customers.arenaId, customers.id], name: "bookings_arena_customer_fk" }),
    foreignKey({ columns: [t.arenaId, t.slotId], foreignColumns: [sessionSlots.arenaId, sessionSlots.id], name: "bookings_arena_slot_fk" }),
    foreignKey({ columns: [t.arenaId, t.teamId], foreignColumns: [teams.arenaId, teams.id], name: "bookings_arena_team_fk" }),
  ]
)

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "restrict" }),
    ticketNumber: text("ticket_number").notNull(),
    /** Unique: a confirmed booking yields exactly one ticket. */
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
    slotId: uuid("slot_id").references(() => sessionSlots.id, { onDelete: "set null" }),
    playerName: text("player_name").notNull(),
    ticketType: ticketTypeEnum("ticket_type").notNull().default("STANDARD"),
    price: integer("price").notNull(),
    currency: text("currency").notNull(),
    paymentStatus: paymentStatusEnum("payment_status").notNull().default("PAID"),
    status: ticketStatusEnum("status").notNull().default("CONFIRMED"),
    /** Opaque signed reference embedded in the QR code. Never personal data. */
    qrToken: text("qr_token").notNull(),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    validatedBy: uuid("validated_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    // Ticket numbers and QR tokens stay globally unique: they are printed,
    // scanned and shared, and a collision between arenas would be a real
    // confusion rather than a tenancy question.
    uniqueIndex("tickets_number_idx").on(t.ticketNumber),
    uniqueIndex("tickets_qr_token_idx").on(t.qrToken),
    uniqueIndex("tickets_booking_idx").on(t.bookingId),
    uniqueIndex("tickets_arena_id_key").on(t.arenaId, t.id),
    index("tickets_arena_session_status_idx").on(t.arenaId, t.sessionId, t.status),
    index("tickets_arena_customer_idx").on(t.arenaId, t.customerId),
    index("tickets_arena_purchased_idx").on(t.arenaId, t.purchasedAt),
    foreignKey({ columns: [t.arenaId, t.bookingId], foreignColumns: [bookings.arenaId, bookings.id], name: "tickets_arena_booking_fk" }),
    foreignKey({ columns: [t.arenaId, t.sessionId], foreignColumns: [sessions.arenaId, sessions.id], name: "tickets_arena_session_fk" }),
    foreignKey({ columns: [t.arenaId, t.customerId], foreignColumns: [customers.arenaId, customers.id], name: "tickets_arena_customer_fk" }),
  ]
)

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "restrict" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    /** Our reference sent to the provider; unique so callbacks are idempotent. */
    reference: text("reference").notNull(),
    providerTransactionId: text("provider_transaction_id"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    authorizationUrl: text("authorization_url"),
    channel: text("channel"),
    failureReason: text("failure_reason"),
    providerPayload: jsonb("provider_payload"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    /** Set when the customer was charged but no ticket could be issued (session filled after the hold expired). Cleared by nothing: status REFUNDED marks it resolved. */
    refundRequiredAt: timestamp("refund_required_at", { withTimezone: true }),
    refundRequiredReason: text("refund_required_reason"),
    ...timestamps,
  },
  (t) => [
    // The provider knows the reference, not the arena, so it stays globally unique.
    uniqueIndex("payments_reference_idx").on(t.reference),
    uniqueIndex("payments_arena_id_key").on(t.arenaId, t.id),
    index("payments_arena_booking_idx").on(t.arenaId, t.bookingId),
    index("payments_arena_status_created_idx").on(t.arenaId, t.status, t.createdAt),
    // Reconciliation sweeps every arena, so this one leads with status.
    index("payments_status_created_idx").on(t.status, t.createdAt),
    foreignKey({ columns: [t.arenaId, t.bookingId], foreignColumns: [bookings.arenaId, bookings.id], name: "payments_arena_booking_fk" }),
    foreignKey({ columns: [t.arenaId, t.customerId], foreignColumns: [customers.arenaId, customers.id], name: "payments_arena_customer_fk" }),
  ]
)

/**
 * Every webhook the provider delivers, stored before it is acted on.
 *
 * The unique key is the fingerprint of the delivery, so a replayed request —
 * the same signed body sent again, deliberately or by the provider's own
 * retry — matches an existing row and is acknowledged without being processed
 * a second time.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null until the event is matched to a payment: the provider knows nothing about arenas. */
    arenaId: uuid("arena_id").references(() => arenas.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    reference: text("reference"),
    /** SHA-256 of provider + signature + body: identical deliveries collide here. */
    fingerprint: text("fingerprint").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    outcome: text("outcome"),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_events_fingerprint_idx").on(t.fingerprint),
    index("payment_events_arena_created_idx").on(t.arenaId, t.createdAt),
    index("payment_events_reference_idx").on(t.reference),
  ]
)

/** Immutable ledger of money movements. */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "restrict" }),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "set null" }),
    type: transactionTypeEnum("type").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull(),
    provider: text("provider").notNull(),
    providerReference: text("provider_reference"),
    reason: text("reason"),
    metadata: jsonb("metadata"),
    performedBy: uuid("performed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transactions_arena_created_idx").on(t.arenaId, t.createdAt),
    index("transactions_payment_idx").on(t.paymentId),
    foreignKey({ columns: [t.arenaId, t.paymentId], foreignColumns: [payments.arenaId, payments.id], name: "transactions_arena_payment_fk" }),
    foreignKey({ columns: [t.arenaId, t.ticketId], foreignColumns: [tickets.arenaId, tickets.id], name: "transactions_arena_ticket_fk" }),
  ]
)

export const ticketValidations = pgTable(
  "ticket_validations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Scans are tenant-scoped: an agent may only scan tickets of their own arena. */
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "restrict" }),
    ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").references(() => sessions.id, { onDelete: "cascade" }),
    validatedBy: uuid("validated_by").references(() => users.id, { onDelete: "set null" }),
    result: text("result").notNull(),
    /** Why the scan ended the way it did, for the gate staff and for support. */
    reason: text("reason"),
    /**
     * A *redacted* rendering of what was scanned. The raw value is a live
     * credential — an unused QR token would let anyone who can read this table
     * walk in on someone else's ticket — so only a recognisable fragment is
     * kept.
     */
    scannedValue: text("scanned_value"),
    /** SHA-256 of the scanned value, so repeated forgeries can be correlated without storing them. */
    scannedFingerprint: text("scanned_fingerprint"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ticket_validations_arena_created_idx").on(t.arenaId, t.createdAt),
    index("ticket_validations_ticket_idx").on(t.ticketId),
    foreignKey({ columns: [t.arenaId, t.ticketId], foreignColumns: [tickets.arenaId, tickets.id], name: "ticket_validations_arena_ticket_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.arenaId, t.sessionId], foreignColumns: [sessions.arenaId, sessions.id], name: "ticket_validations_arena_session_fk" }).onDelete("cascade"),
  ]
)

export const waitlistEntries = pgTable(
  "waitlist_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "restrict" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("waitlist_session_email_idx").on(t.sessionId, sql`lower(${t.email})`),
    foreignKey({ columns: [t.arenaId, t.sessionId], foreignColumns: [sessions.arenaId, sessions.id], name: "waitlist_arena_session_fk" }).onDelete("cascade"),
  ]
)

// ---------------------------------------------------------------------------
// CMS
// ---------------------------------------------------------------------------
export const media = pgTable(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "restrict" }),
    storageKey: text("storage_key").notNull().unique(),
    url: text("url").notNull(),
    filename: text("filename").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text"),
    folder: text("folder").notNull().default("general"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("media_arena_folder_idx").on(t.arenaId, t.folder),
    uniqueIndex("media_arena_id_key").on(t.arenaId, t.id),
  ]
)

/** Structured page content with separate draft and published states. */
export const cmsPages = pgTable(
  "cms_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "cascade" }),
    slug: cmsPageSlugEnum("slug").notNull(),
    draft: jsonb("draft").notNull(),
    published: jsonb("published"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("cms_pages_arena_slug_idx").on(t.arenaId, t.slug)]
)

export const cmsServices = pgTable(
  "cms_services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    icon: text("icon"),
    imageMediaId: uuid("image_media_id").references(() => media.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("cms_services_order_idx").on(t.arenaId, t.sortOrder),
    // An arena cannot illustrate its services with another arena's media.
    foreignKey({ columns: [t.arenaId, t.imageMediaId], foreignColumns: [media.arenaId, media.id], name: "cms_services_arena_media_fk" }).onDelete("set null"),
  ]
)

export const faqs = pgTable(
  "faqs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("faqs_order_idx").on(t.arenaId, t.sortOrder)]
)

export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    imageMediaId: uuid("image_media_id").references(() => media.id, { onDelete: "set null" }),
    status: announcementStatusEnum("status").notNull().default("DRAFT"),
    publishAt: timestamp("publish_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("announcements_arena_status_idx").on(t.arenaId, t.status, t.publishAt),
    foreignKey({ columns: [t.arenaId, t.imageMediaId], foreignColumns: [media.arenaId, media.id], name: "announcements_arena_media_fk" }).onDelete("set null"),
  ]
)

export const banners = pgTable(
  "banners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaId: uuid("arena_id")
      .notNull()
      .references(() => arenas.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    imageMediaId: uuid("image_media_id").references(() => media.id, { onDelete: "set null" }),
    linkUrl: text("link_url"),
    linkLabel: text("link_label"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("banners_arena_active_order_idx").on(t.arenaId, t.isActive, t.sortOrder),
    foreignKey({ columns: [t.arenaId, t.imageMediaId], foreignColumns: [media.arenaId, media.id], name: "banners_arena_media_fk" }).onDelete("set null"),
  ]
)

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for a platform-level notice that belongs to no tenant. Every query is an equality test, so such a row is invisible to all arenas. */
    arenaId: uuid("arena_id").references(() => arenas.id, { onDelete: "set null" }),
    recipientType: principalTypeEnum("recipient_type").notNull(),
    recipientId: uuid("recipient_id"),
    recipientAddress: text("recipient_address"),
    channel: notificationChannelEnum("channel").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data"),
    status: notificationStatusEnum("status").notNull().default("PENDING"),
    error: text("error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_recipient_idx").on(t.recipientType, t.recipientId, t.status),
    index("notifications_arena_status_idx").on(t.arenaId, t.status, t.createdAt),
    // The dispatcher retries across arenas, so this one leads with status.
    index("notifications_status_idx").on(t.status, t.createdAt),
  ]
)

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for a platform-level action — changing the shared role catalogue belongs to no arena. */
    arenaId: uuid("arena_id").references(() => arenas.id, { onDelete: "set null" }),
    actorType: principalTypeEnum("actor_type").notNull(),
    actorId: uuid("actor_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    description: text("description").notNull(),
    metadata: jsonb("metadata"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_arena_created_idx").on(t.arenaId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_actor_idx").on(t.actorType, t.actorId),
  ]
)

export const systemSettings = pgTable(
  "system_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null = platform-wide default; arena rows override. */
    arenaId: uuid("arena_id").references(() => arenas.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("system_settings_scope_key_idx").on(sql`coalesce(${t.arenaId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.key)]
)

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------
export type Arena = typeof arenas.$inferSelect
export type Role = typeof roles.$inferSelect
export type User = typeof users.$inferSelect
export type ArenaMembership = typeof arenaMemberships.$inferSelect
export type Organization = typeof organizations.$inferSelect
export type ArenaDomain = typeof arenaDomains.$inferSelect
export type ArenaPaymentAccount = typeof arenaPaymentAccounts.$inferSelect
export type Customer = typeof customers.$inferSelect
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect
export type AuthSession = typeof authSessions.$inferSelect
export type Session = typeof sessions.$inferSelect
export type NewSession = typeof sessions.$inferInsert
export type Team = typeof teams.$inferSelect
export type SessionSlot = typeof sessionSlots.$inferSelect
export type Booking = typeof bookings.$inferSelect
export type Ticket = typeof tickets.$inferSelect
export type Payment = typeof payments.$inferSelect
export type PaymentEvent = typeof paymentEvents.$inferSelect
export type Transaction = typeof transactions.$inferSelect
export type Media = typeof media.$inferSelect
export type CmsPage = typeof cmsPages.$inferSelect
export type CmsService = typeof cmsServices.$inferSelect
export type Faq = typeof faqs.$inferSelect
export type Announcement = typeof announcements.$inferSelect
export type Banner = typeof banners.$inferSelect
export type Notification = typeof notifications.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
export type SystemSetting = typeof systemSettings.$inferSelect
export type Plan = typeof plans.$inferSelect
export type Subscription = typeof subscriptions.$inferSelect
export type SubscriptionEvent = typeof subscriptionEvents.$inferSelect
export type UsageRecord = typeof usageRecords.$inferSelect
export type FeatureFlagRow = typeof featureFlags.$inferSelect
export type Impersonation = typeof impersonations.$inferSelect
