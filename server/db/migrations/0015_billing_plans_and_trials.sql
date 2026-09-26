-- Phase 1 of platform billing: a plan catalogue, and a subscription for every
-- organization that already exists.
--
-- Prices are placeholders in minor units (kobo). They are deliberately obvious
-- round numbers so nobody mistakes them for a commercial decision: set them
-- before taking a single payment.

INSERT INTO "plans" ("key", "name", "description", "price_minor", "currency", "interval",
                     "max_arenas", "max_sessions_per_month", "max_staff", "is_public", "sort_order")
VALUES
  ('starter', 'Starter', 'One arena, for a single venue finding its feet.',
   0, 'NGN', 'MONTHLY', 1, 20, 5, true, 10),
  ('growth', 'Growth', 'Up to three arenas, with room to run a full fixture list.',
   2500000, 'NGN', 'MONTHLY', 3, 100, 20, true, 20),
  ('scale', 'Scale', 'Unlimited arenas, sessions and staff.',
   7500000, 'NGN', 'MONTHLY', NULL, NULL, NULL, true, 30),
  -- Not on sale: for venues the platform does not charge. Kept out of the
  -- public catalogue so it can never be self-selected.
  ('comped', 'Comped', 'Internal: unlimited, not billed.',
   0, 'NGN', 'MONTHLY', NULL, NULL, NULL, false, 99)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Every existing organization gets a trial on the default plan. An
-- organization without a subscription would otherwise be a shape every later
-- read has to interpret, and they would not all interpret it the same way.
INSERT INTO "subscriptions" ("organization_id", "plan_id", "status",
                             "current_period_start", "current_period_end", "trial_ends_at")
SELECT o."id",
       (SELECT "id" FROM "plans" WHERE "key" = 'starter'),
       'TRIALING',
       now(),
       now() + interval '30 days',
       now() + interval '30 days'
FROM "organizations" o
WHERE o."deleted_at" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."organization_id" = o."id");
--> statement-breakpoint

INSERT INTO "subscription_events" ("subscription_id", "organization_id", "type", "to_status", "metadata")
SELECT s."id", s."organization_id", 'trial_started', 'TRIALING',
       jsonb_build_object('planKey', 'starter', 'trialDays', 30, 'source', 'backfill')
FROM "subscriptions" s
WHERE NOT EXISTS (SELECT 1 FROM "subscription_events" e WHERE e."subscription_id" = s."id");
--> statement-breakpoint

-- The two new arena permissions, for deployments whose roles are already
-- seeded. Owners get both; nobody else does, because billing is the
-- organization's contract rather than the arena's day-to-day.
--
-- The EXISTS clause is load-bearing. `baseline.ts` seeds a role's defaults
-- only when it has no permissions at all — otherwise it would silently restore
-- permissions an operator had deliberately revoked. On a fresh install
-- migrations run first, so granting billing here would leave ARENA_OWNER
-- holding two permissions and baseline declining to add the other twenty-five.
-- Every arena owner would be locked out of their own arena. A fresh install
-- gets these from DEFAULT_ROLE_PERMISSIONS instead.
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r."id", p."permission"
FROM "roles" r
CROSS JOIN (VALUES ('billing.view'), ('billing.manage')) AS p("permission")
WHERE r."key" IN ('ARENA_OWNER', 'PLATFORM_OWNER')
  AND EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."role_id" = r."id")
ON CONFLICT DO NOTHING;
