-- Scan records gain a reason and stop storing a live credential.
--
-- `scanned_value` held whatever was scanned, in full. For an unused ticket
-- that is a working QR payload: anyone able to read this table could walk in
-- on someone else's ticket. New rows store only a recognisable fragment plus
-- a fingerprint; the existing values are redacted below.

ALTER TABLE "ticket_validations" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD COLUMN "scanned_fingerprint" text;
--> statement-breakpoint

-- Redact what is already stored. A ticket number is not a credential and is
-- kept whole; a QR payload keeps its prefix and last four characters.
--
-- No fingerprint is backfilled: it exists to correlate repeated forgeries
-- going forward, and computing one here would need pgcrypto, which the
-- embedded development database does not carry.
UPDATE "ticket_validations"
SET "scanned_value" = 'AP1.…' || right("scanned_value", 4)
WHERE "scanned_value" LIKE 'AP1.%';
