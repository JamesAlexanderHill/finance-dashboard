CREATE TYPE "public"."transaction_role" AS ENUM('principal', 'fee');--> statement-breakpoint
ALTER TYPE "public"."decision_kind" ADD VALUE 'transfer';--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "provider_group_ref" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "role" "transaction_role" DEFAULT 'principal' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "is_transfer_hint" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "transactions_group_ref_idx" ON "transactions" USING btree ("workspace_id","provider_group_ref");