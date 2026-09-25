-- Tenant integrity at the storage layer.
--
-- Up to here a cross-tenant row was prevented by application code. From here
-- it is unrepresentable: every child of a tenant-owned row carries
-- (arena_id, <parent_id>) and references the parent's (arena_id, id), so a
-- booking in one arena cannot point at a session, customer, slot or team in
-- another — whatever the service layer does.
--
-- The three `customers_*` index statements are written defensively because
-- migration 0007 already performed them; everything else is new.

CREATE UNIQUE INDEX "bookings_arena_id_key" ON "bookings" USING btree ("arena_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "customers_arena_id_key" ON "customers" USING btree ("arena_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "media_arena_id_key" ON "media" USING btree ("arena_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_arena_id_key" ON "payments" USING btree ("arena_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "session_slots_arena_id_key" ON "session_slots" USING btree ("arena_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_arena_id_key" ON "sessions" USING btree ("arena_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "teams_arena_id_key" ON "teams" USING btree ("arena_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_arena_id_key" ON "tickets" USING btree ("arena_id","id");
--> statement-breakpoint
ALTER TABLE "customers" DROP CONSTRAINT "customers_arena_id_arenas_id_fk";
--> statement-breakpoint
ALTER TABLE "media" DROP CONSTRAINT "media_arena_id_arenas_id_fk";
--> statement-breakpoint
DROP INDEX "announcements_status_publish_idx";
--> statement-breakpoint
DROP INDEX "audit_logs_created_idx";
--> statement-breakpoint
DROP INDEX "banners_active_order_idx";
--> statement-breakpoint
DROP INDEX "bookings_idempotency_idx";
--> statement-breakpoint
DROP INDEX "bookings_session_status_idx";
--> statement-breakpoint
DROP INDEX "bookings_customer_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "customers_email_lower_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "customers_google_sub_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "customers_username_lower_idx";
--> statement-breakpoint
DROP INDEX "media_folder_idx";
--> statement-breakpoint
DROP INDEX "payments_booking_idx";
--> statement-breakpoint
DROP INDEX "tickets_session_idx";
--> statement-breakpoint
DROP INDEX "tickets_customer_idx";
--> statement-breakpoint
DROP INDEX "transactions_created_idx";
--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "arena_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "arenas" ALTER COLUMN "organization_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "banners" ALTER COLUMN "arena_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "cms_pages" ALTER COLUMN "arena_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "cms_services" ALTER COLUMN "arena_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "customers" ALTER COLUMN "arena_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "faqs" ALTER COLUMN "arena_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "media" ALTER COLUMN "arena_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "session_slots" ALTER COLUMN "arena_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "arena_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ticket_validations" ALTER COLUMN "arena_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ALTER COLUMN "arena_id" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "announcements_arena_status_idx" ON "announcements" USING btree ("arena_id","status","publish_at");
--> statement-breakpoint
CREATE INDEX "audit_logs_arena_created_idx" ON "audit_logs" USING btree ("arena_id","created_at");
--> statement-breakpoint
CREATE INDEX "banners_arena_active_order_idx" ON "banners" USING btree ("arena_id","is_active","sort_order");
--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_arena_idempotency_idx" ON "bookings" USING btree ("arena_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "bookings_arena_session_status_idx" ON "bookings" USING btree ("arena_id","session_id","status");
--> statement-breakpoint
CREATE INDEX "bookings_arena_customer_idx" ON "bookings" USING btree ("arena_id","customer_id");
--> statement-breakpoint
CREATE INDEX "bookings_arena_created_idx" ON "bookings" USING btree ("arena_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customers_arena_email_idx" ON "customers" USING btree ("arena_id",lower("email"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customers_arena_username_idx" ON "customers" USING btree ("arena_id",lower("username"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customers_arena_google_sub_idx" ON "customers" USING btree ("arena_id","google_sub");
--> statement-breakpoint
CREATE INDEX "customers_arena_created_idx" ON "customers" USING btree ("arena_id","created_at");
--> statement-breakpoint
CREATE INDEX "media_arena_folder_idx" ON "media" USING btree ("arena_id","folder");
--> statement-breakpoint
CREATE INDEX "notifications_arena_status_idx" ON "notifications" USING btree ("arena_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "payments_arena_booking_idx" ON "payments" USING btree ("arena_id","booking_id");
--> statement-breakpoint
CREATE INDEX "payments_arena_status_created_idx" ON "payments" USING btree ("arena_id","status","created_at");
--> statement-breakpoint
CREATE INDEX "ticket_validations_arena_created_idx" ON "ticket_validations" USING btree ("arena_id","created_at");
--> statement-breakpoint
CREATE INDEX "tickets_arena_session_status_idx" ON "tickets" USING btree ("arena_id","session_id","status");
--> statement-breakpoint
CREATE INDEX "tickets_arena_customer_idx" ON "tickets" USING btree ("arena_id","customer_id");
--> statement-breakpoint
CREATE INDEX "tickets_arena_purchased_idx" ON "tickets" USING btree ("arena_id","purchased_at");
--> statement-breakpoint
CREATE INDEX "transactions_arena_created_idx" ON "transactions" USING btree ("arena_id","created_at");
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_arena_media_fk" FOREIGN KEY ("arena_id","image_media_id") REFERENCES "public"."media"("arena_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "banners" ADD CONSTRAINT "banners_arena_media_fk" FOREIGN KEY ("arena_id","image_media_id") REFERENCES "public"."media"("arena_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_arena_session_fk" FOREIGN KEY ("arena_id","session_id") REFERENCES "public"."sessions"("arena_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_arena_customer_fk" FOREIGN KEY ("arena_id","customer_id") REFERENCES "public"."customers"("arena_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_arena_slot_fk" FOREIGN KEY ("arena_id","slot_id") REFERENCES "public"."session_slots"("arena_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_arena_team_fk" FOREIGN KEY ("arena_id","team_id") REFERENCES "public"."teams"("arena_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cms_services" ADD CONSTRAINT "cms_services_arena_media_fk" FOREIGN KEY ("arena_id","image_media_id") REFERENCES "public"."media"("arena_id","id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_arena_booking_fk" FOREIGN KEY ("arena_id","booking_id") REFERENCES "public"."bookings"("arena_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_arena_customer_fk" FOREIGN KEY ("arena_id","customer_id") REFERENCES "public"."customers"("arena_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session_slots" ADD CONSTRAINT "session_slots_arena_session_fk" FOREIGN KEY ("arena_id","session_id") REFERENCES "public"."sessions"("arena_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session_slots" ADD CONSTRAINT "session_slots_arena_team_fk" FOREIGN KEY ("arena_id","team_id") REFERENCES "public"."teams"("arena_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_arena_session_fk" FOREIGN KEY ("arena_id","session_id") REFERENCES "public"."sessions"("arena_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD CONSTRAINT "ticket_validations_arena_ticket_fk" FOREIGN KEY ("arena_id","ticket_id") REFERENCES "public"."tickets"("arena_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD CONSTRAINT "ticket_validations_arena_session_fk" FOREIGN KEY ("arena_id","session_id") REFERENCES "public"."sessions"("arena_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_arena_booking_fk" FOREIGN KEY ("arena_id","booking_id") REFERENCES "public"."bookings"("arena_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_arena_session_fk" FOREIGN KEY ("arena_id","session_id") REFERENCES "public"."sessions"("arena_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_arena_customer_fk" FOREIGN KEY ("arena_id","customer_id") REFERENCES "public"."customers"("arena_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_arena_payment_fk" FOREIGN KEY ("arena_id","payment_id") REFERENCES "public"."payments"("arena_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_arena_ticket_fk" FOREIGN KEY ("arena_id","ticket_id") REFERENCES "public"."tickets"("arena_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_arena_session_fk" FOREIGN KEY ("arena_id","session_id") REFERENCES "public"."sessions"("arena_id","id") ON DELETE cascade ON UPDATE no action;
