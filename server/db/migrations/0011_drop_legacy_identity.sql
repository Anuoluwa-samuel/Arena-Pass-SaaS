-- Retires the pre-tenancy identity columns.
--
-- `users.arena_id` and `users.role_id` were how access worked before
-- memberships existed; `arenas.is_active` was superseded by `status`. Nothing
-- has read them since the authorization migration, and the tenancy backfill
-- created a membership for every user that had an arena.
--
-- This is the one destructive step in the sequence, so it refuses to run if
-- any active user would be left with no way in — no ACTIVE membership and no
-- platform role. That user's access lives only in the columns about to be
-- dropped, and dropping them would lock them out silently.
DO $$
DECLARE stranded int;
BEGIN
  SELECT count(*) INTO stranded
  FROM users u
  WHERE u.is_active
    AND u.deleted_at IS NULL
    AND u.platform_role_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM arena_memberships m
      WHERE m.user_id = u.id AND m.status = 'ACTIVE'
    );
  IF stranded > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop the legacy identity columns: % active user(s) have neither an arena membership nor a platform role. Give them a membership first.', stranded;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_arena_id_arenas_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_id_roles_id_fk";
--> statement-breakpoint
ALTER TABLE "arenas" DROP COLUMN "is_active";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "arena_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role_id";--> statement-breakpoint
DROP TYPE "public"."role_key";