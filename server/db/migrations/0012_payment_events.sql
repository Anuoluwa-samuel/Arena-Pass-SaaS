CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arena_id" uuid,
	"payment_id" uuid,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"reference" text,
	"fingerprint" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_arena_id_arenas_id_fk" FOREIGN KEY ("arena_id") REFERENCES "public"."arenas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_fingerprint_idx" ON "payment_events" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "payment_events_arena_created_idx" ON "payment_events" USING btree ("arena_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_events_reference_idx" ON "payment_events" USING btree ("reference");