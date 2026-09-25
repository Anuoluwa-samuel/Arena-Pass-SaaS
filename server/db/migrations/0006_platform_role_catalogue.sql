-- Move role-catalogue management to platform scope.
--
-- `roles` is a single catalogue shared by every arena: changing what MANAGER
-- may do changes it in all of them. Granting `roles.manage` to ARENA_OWNER —
-- which the v2 default set did, because it granted every arena permission —
-- therefore let one tenant's owner widen their staff's access inside every
-- other tenant. The same applies to `arenas.manage`.
--
-- Both are replaced by platform permissions. Idempotent.

DELETE FROM "role_permissions" WHERE "permission" IN ('roles.manage', 'arenas.manage');
--> statement-breakpoint

INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'platform.roles.manage' FROM "roles" WHERE "key" = 'PLATFORM_OWNER'
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- `users.view` / `users.manage` were the single-arena names for staff
-- management. The tenancy backfill already granted the `staff.*` equivalents
-- to every role that held them, so the old names are now dead vocabulary.
DELETE FROM "role_permissions" WHERE "permission" IN ('users.view', 'users.manage');
