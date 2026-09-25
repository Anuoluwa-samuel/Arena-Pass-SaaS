-- Customers become arena-scoped.
--
-- Until now `customers` had a *global* unique index on lower(email), so two
-- arenas could not both have a customer with the same address: the second
-- arena's booking either reused the first arena's customer row — a
-- cross-tenant leak — or failed outright. Neither is acceptable once the
-- services are scoped, so the identity moves inside the arena.
--
-- The same applies to `username` (a public handle, per storefront) and
-- `google_sub` (one person may hold an account at several arenas).
--
-- Idempotent and non-destructive: no customer row is deleted or merged.

-- 1. Attribute each existing customer to the arena they actually played at.
--    A customer can only have booked at one arena so far, precisely because
--    the global index made a second arena impossible.
UPDATE "customers" c
SET "arena_id" = b."arena_id", "updated_at" = now()
FROM (SELECT DISTINCT "customer_id", "arena_id" FROM "bookings") b
WHERE c."arena_id" IS NULL AND b."customer_id" = c."id";
--> statement-breakpoint

UPDATE "customers" c
SET "arena_id" = t."arena_id", "updated_at" = now()
FROM (SELECT DISTINCT "customer_id", "arena_id" FROM "tickets") t
WHERE c."arena_id" IS NULL AND t."customer_id" = c."id";
--> statement-breakpoint

-- 2. Accounts that never booked (signed up, never played) belong to the only
--    arena that existed when they registered. With more than one arena this
--    is left NULL rather than guessed, and the NOT NULL constraint added
--    later will refuse to apply until a human decides.
UPDATE "customers"
SET "arena_id" = (SELECT "id" FROM "arenas" WHERE "deleted_at" IS NULL), "updated_at" = now()
WHERE "arena_id" IS NULL AND (SELECT count(*) FROM "arenas" WHERE "deleted_at" IS NULL) = 1;
--> statement-breakpoint

-- 3. Swap global uniqueness for per-arena uniqueness.
DROP INDEX IF EXISTS "customers_email_lower_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_arena_email_idx" ON "customers" USING btree ("arena_id", lower("email"));
--> statement-breakpoint

DROP INDEX IF EXISTS "customers_username_lower_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_arena_username_idx" ON "customers" USING btree ("arena_id", lower("username"));
--> statement-breakpoint

DROP INDEX IF EXISTS "customers_google_sub_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_arena_google_sub_idx" ON "customers" USING btree ("arena_id", "google_sub");
