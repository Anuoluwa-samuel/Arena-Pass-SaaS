-- Re-runs the denormalised `arena_id` backfill for teams and session slots.
--
-- The 0005 backfill filled in every row that existed then, but sessions
-- created between that migration and the fix to `generateTeamsAndSlots` wrote
-- their grid without an arena. This catches those, and is a harmless no-op
-- afterwards. Derived from the parent session, so it cannot disagree with it.

UPDATE "teams" t SET "arena_id" = s."arena_id"
FROM "sessions" s WHERE t."session_id" = s."id" AND t."arena_id" IS NULL;
--> statement-breakpoint

UPDATE "session_slots" sl SET "arena_id" = s."arena_id"
FROM "sessions" s WHERE sl."session_id" = s."id" AND sl."arena_id" IS NULL;
