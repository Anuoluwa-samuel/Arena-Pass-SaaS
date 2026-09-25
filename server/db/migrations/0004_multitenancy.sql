CREATE TYPE "public"."arena_status" AS ENUM('PENDING_SETUP', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('PENDING', 'VERIFIED', 'FAILED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."onboarding_step" AS ENUM('organization', 'arena', 'branding', 'payments', 'first_session', 'staff', 'launched');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('PENDING_SETUP', 'ACTIVE', 'SUSPENDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."payment_account_status" AS ENUM('PENDING', 'ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."role_scope" AS ENUM('PLATFORM', 'ARENA');--> statement-breakpoint
CREATE TABLE "arena_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"status" "domain_status" DEFAULT 'PENDING' NOT NULL,
	"verification_token" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'ACTIVE' NOT NULL,
	"invited_by_user_id" uuid,
	"invited_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"secret_key_encrypted" text,
	"public_key" text,
	"webhook_secret_encrypted" text,
	"provider_account_id" text,
	"status" "payment_account_status" DEFAULT 'PENDING' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"billing_email" text,
	"country" text DEFAULT 'NG' NOT NULL,
	"status" "organization_status" DEFAULT 'PENDING_SETUP' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "key" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "status" "arena_status" DEFAULT 'PENDING_SETUP' NOT NULL;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "logo_media_id" uuid;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "brand_primary_color" text;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "brand_accent_color" text;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "onboarding_step" "onboarding_step" DEFAULT 'organization' NOT NULL;--> statement-breakpoint
ALTER TABLE "arenas" ADD COLUMN "launched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "scope" "role_scope" DEFAULT 'ARENA' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_slots" ADD COLUMN "arena_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "arena_id" uuid;--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD COLUMN "arena_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_role_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "arena_id" uuid;--> statement-breakpoint
ALTER TABLE "arena_domains" ADD CONSTRAINT "arena_domains_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_memberships" ADD CONSTRAINT "arena_memberships_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_memberships" ADD CONSTRAINT "arena_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_memberships" ADD CONSTRAINT "arena_memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_memberships" ADD CONSTRAINT "arena_memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_payment_accounts" ADD CONSTRAINT "arena_payment_accounts_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arena_domains_hostname_idx" ON "arena_domains" USING btree (lower("hostname"));--> statement-breakpoint
CREATE INDEX "arena_domains_arena_idx" ON "arena_domains" USING btree ("arena_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "arena_memberships_arena_user_idx" ON "arena_memberships" USING btree ("arena_id","user_id");--> statement-breakpoint
CREATE INDEX "arena_memberships_user_status_idx" ON "arena_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "arena_memberships_arena_status_idx" ON "arena_memberships" USING btree ("arena_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "arena_payment_accounts_arena_provider_idx" ON "arena_payment_accounts" USING btree ("arena_id","provider");--> statement-breakpoint
CREATE INDEX "arena_payment_accounts_status_idx" ON "arena_payment_accounts" USING btree ("arena_id","status");--> statement-breakpoint
ALTER TABLE "arenas" ADD CONSTRAINT "arenas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_slots" ADD CONSTRAINT "session_slots_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD CONSTRAINT "ticket_validations_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_platform_role_id_roles_id_fk" FOREIGN KEY ("platform_role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arenas_organization_idx" ON "arenas" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "arenas_status_idx" ON "arenas" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "arenas_id_key" ON "arenas" USING btree ("id");--> statement-breakpoint
CREATE INDEX "roles_scope_idx" ON "roles" USING btree ("scope");--> statement-breakpoint
-- Data: bring existing role rows onto the v2 vocabulary BEFORE the CHECK below
-- is added, otherwise the constraint would reject rows written by the
-- single-arena schema. Idempotent: a second run matches no rows.
UPDATE "roles" SET "key" = 'PLATFORM_OWNER' WHERE "key" = 'SUPER_ADMIN';--> statement-breakpoint
UPDATE "roles" SET "key" = 'ARENA_ADMIN' WHERE "key" = 'ADMIN';--> statement-breakpoint
UPDATE "roles" SET "scope" = 'PLATFORM' WHERE "key" IN ('PLATFORM_OWNER', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT');--> statement-breakpoint
UPDATE "roles" SET "scope" = 'ARENA' WHERE "key" NOT IN ('PLATFORM_OWNER', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT');--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_key_known" CHECK (key in ('PLATFORM_OWNER', 'PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'ARENA_OWNER', 'ARENA_ADMIN', 'MANAGER', 'FINANCE', 'TICKET_AGENT', 'STAFF'));