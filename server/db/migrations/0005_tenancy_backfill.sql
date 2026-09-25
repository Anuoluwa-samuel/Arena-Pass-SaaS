-- Tenancy backfill.
--
-- Converts a single-arena database into the multi-tenant shape without losing
-- a row: every existing arena gets an organization, every existing admin user
-- gets an arena membership, and the tables that gained an `arena_id` in 0004
-- have it filled in from their parent. Every statement is idempotent, so a
-- re-run is a no-op rather than a duplicate.
--
-- Nothing here is destructive: no DELETE, no DROP, no column removal. The
-- pre-tenancy columns (`users.arena_id`, `users.role_id`, `arenas.is_active`)
-- are left in place and still authoritative until the identity migration.

-- 1. Roles the v2 vocabulary adds. Permissions for them are seeded by
--    ensureBaseline on the next boot.
INSERT INTO "roles" ("key", "scope", "name", "is_system")
VALUES
  ('ARENA_OWNER', 'ARENA', 'Arena Owner', true),
  ('PLATFORM_ADMIN', 'PLATFORM', 'Platform Admin', true),
  ('PLATFORM_SUPPORT', 'PLATFORM', 'Platform Support', true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- 1b. Permissions the v2 vocabulary adds. `ensureBaseline` only seeds a role
--     that has no permissions at all, so that an operator's customisation is
--     never silently overwritten — which means a role that already existed
--     would never learn about a newly introduced permission. The grants below
--     are therefore explicit and conservative: a role gains a new permission
--     only where it already held the capability that permission replaces.
--
--     `staff.*` splits the old `users.*` pair into per-arena staff management.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT rp."role_id", 'staff.view'
FROM "role_permissions" rp
WHERE rp."permission" = 'users.view'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT rp."role_id", p."permission"
FROM "role_permissions" rp
CROSS JOIN (VALUES ('staff.invite'), ('staff.update'), ('staff.remove')) AS p("permission")
WHERE rp."permission" = 'users.manage'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

--     The platform owner holds every permission by definition: the roles UI
--     refuses to edit it, so there is no customisation to preserve.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
FROM "roles" r
CROSS JOIN (VALUES
  ('platform.overview.view'), ('platform.organizations.view'), ('platform.organizations.manage'),
  ('platform.arenas.view'), ('platform.arenas.manage'), ('platform.users.view'), ('platform.users.manage'),
  ('platform.subscriptions.view'), ('platform.subscriptions.manage'), ('platform.audit.view'),
  ('platform.impersonate'), ('platform.settings.manage')
) AS p("permission")
WHERE r."key" = 'PLATFORM_OWNER'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 2. One organization per existing arena. The arena's own slug is reused, so
--    the result is deterministic and a re-run collides on the unique slug
--    instead of creating a second organization.
INSERT INTO "organizations" ("slug", "name", "status", "country", "created_at", "updated_at")
SELECT a."slug", a."name", 'ACTIVE', COALESCE(a."country", 'NG'), a."created_at", now()
FROM "arenas" a
WHERE a."organization_id" IS NULL AND a."deleted_at" IS NULL
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint

UPDATE "arenas" a
SET "organization_id" = o."id", "updated_at" = now()
FROM "organizations" o
WHERE a."organization_id" IS NULL AND o."slug" = a."slug";
--> statement-breakpoint

-- 3. Arenas that were live under the old `is_active` flag become ACTIVE and
--    are marked as having finished onboarding. Arenas created after this
--    migration start at PENDING_SETUP and walk the onboarding steps.
UPDATE "arenas"
SET "status" = 'ACTIVE',
    "onboarding_step" = 'launched',
    "launched_at" = COALESCE("launched_at", "created_at"),
    "updated_at" = now()
WHERE "status" = 'PENDING_SETUP' AND "is_active" = true AND "deleted_at" IS NULL;
--> statement-breakpoint

UPDATE "arenas"
SET "status" = 'SUSPENDED', "updated_at" = now()
WHERE "status" = 'PENDING_SETUP' AND "is_active" = false AND "deleted_at" IS NULL;
--> statement-breakpoint

-- 4. Platform staff: a user holding a PLATFORM-scoped role now holds it
--    through `platform_role_id`. `role_id` is left untouched.
UPDATE "users" u
SET "platform_role_id" = u."role_id", "updated_at" = now()
FROM "roles" r
WHERE r."id" = u."role_id" AND r."scope" = 'PLATFORM' AND u."platform_role_id" IS NULL;
--> statement-breakpoint

-- 5. Memberships. A user scoped to an arena keeps the same role there. A
--    platform user who was also operating an arena becomes its ARENA_OWNER,
--    because that is the access they actually had before this migration.
INSERT INTO "arena_memberships" ("arena_id", "user_id", "role_id", "status", "accepted_at", "created_at", "updated_at")
SELECT u."arena_id",
       u."id",
       CASE WHEN r."scope" = 'PLATFORM' THEN owner."id" ELSE u."role_id" END,
       CASE WHEN u."is_active" AND u."deleted_at" IS NULL THEN 'ACTIVE' ELSE 'SUSPENDED' END::"membership_status",
       u."created_at",
       u."created_at",
       now()
FROM "users" u
JOIN "roles" r ON r."id" = u."role_id"
CROSS JOIN LATERAL (SELECT "id" FROM "roles" WHERE "key" = 'ARENA_OWNER') owner
WHERE u."arena_id" IS NOT NULL
ON CONFLICT ("arena_id", "user_id") DO NOTHING;
--> statement-breakpoint

-- 6. Denormalised tenant columns. Each is derived from its parent row, so the
--    value can never disagree with the hierarchy it came from.
UPDATE "teams" t
SET "arena_id" = s."arena_id"
FROM "sessions" s
WHERE t."session_id" = s."id" AND t."arena_id" IS NULL;
--> statement-breakpoint

UPDATE "session_slots" sl
SET "arena_id" = s."arena_id"
FROM "sessions" s
WHERE sl."session_id" = s."id" AND sl."arena_id" IS NULL;
--> statement-breakpoint

UPDATE "waitlist_entries" w
SET "arena_id" = s."arena_id"
FROM "sessions" s
WHERE w."session_id" = s."id" AND w."arena_id" IS NULL;
--> statement-breakpoint

UPDATE "ticket_validations" v
SET "arena_id" = t."arena_id"
FROM "tickets" t
WHERE v."ticket_id" = t."id" AND v."arena_id" IS NULL;
--> statement-breakpoint

-- A scan that matched no ticket still belongs to the arena whose session was
-- being scanned; those rows are how a forged QR code is traced afterwards.
UPDATE "ticket_validations" v
SET "arena_id" = s."arena_id"
FROM "sessions" s
WHERE v."session_id" = s."id" AND v."arena_id" IS NULL;
--> statement-breakpoint

-- 7. Rows that predate `arena_id` being required. Only safe to attribute when
--    the database holds exactly one arena — which is true of every database
--    this migration can encounter, since multi-tenancy starts here. With more
--    than one arena the rows are left NULL and the identity migration's
--    NOT NULL constraint will refuse to apply, which is the correct outcome:
--    a human decides, not a guess.
UPDATE "media" SET "arena_id" = (SELECT "id" FROM "arenas" WHERE "deleted_at" IS NULL)
WHERE "arena_id" IS NULL AND (SELECT count(*) FROM "arenas" WHERE "deleted_at" IS NULL) = 1;
--> statement-breakpoint

UPDATE "cms_pages" SET "arena_id" = (SELECT "id" FROM "arenas" WHERE "deleted_at" IS NULL)
WHERE "arena_id" IS NULL AND (SELECT count(*) FROM "arenas" WHERE "deleted_at" IS NULL) = 1;
--> statement-breakpoint

UPDATE "cms_services" SET "arena_id" = (SELECT "id" FROM "arenas" WHERE "deleted_at" IS NULL)
WHERE "arena_id" IS NULL AND (SELECT count(*) FROM "arenas" WHERE "deleted_at" IS NULL) = 1;
--> statement-breakpoint

UPDATE "faqs" SET "arena_id" = (SELECT "id" FROM "arenas" WHERE "deleted_at" IS NULL)
WHERE "arena_id" IS NULL AND (SELECT count(*) FROM "arenas" WHERE "deleted_at" IS NULL) = 1;
--> statement-breakpoint

UPDATE "announcements" SET "arena_id" = (SELECT "id" FROM "arenas" WHERE "deleted_at" IS NULL)
WHERE "arena_id" IS NULL AND (SELECT count(*) FROM "arenas" WHERE "deleted_at" IS NULL) = 1;
--> statement-breakpoint

UPDATE "banners" SET "arena_id" = (SELECT "id" FROM "arenas" WHERE "deleted_at" IS NULL)
WHERE "arena_id" IS NULL AND (SELECT count(*) FROM "arenas" WHERE "deleted_at" IS NULL) = 1;
--> statement-breakpoint

UPDATE "notifications" SET "arena_id" = (SELECT "id" FROM "arenas" WHERE "deleted_at" IS NULL)
WHERE "arena_id" IS NULL AND (SELECT count(*) FROM "arenas" WHERE "deleted_at" IS NULL) = 1;
--> statement-breakpoint

UPDATE "audit_logs" SET "arena_id" = (SELECT "id" FROM "arenas" WHERE "deleted_at" IS NULL)
WHERE "arena_id" IS NULL AND (SELECT count(*) FROM "arenas" WHERE "deleted_at" IS NULL) = 1;
--> statement-breakpoint

-- `customers.arena_id` is deliberately NOT backfilled here. Customers become
-- arena-scoped in the identity migration, which also replaces the global
-- unique index on email with a per-arena one; doing half of it now would let
-- two arenas fight over the same address in between.

-- `system_settings.arena_id IS NULL` is meaningful — it is the platform-wide
-- default that an arena row overrides — so it is left alone.
