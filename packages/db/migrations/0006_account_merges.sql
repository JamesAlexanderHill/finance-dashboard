ALTER TABLE "financial_accounts" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "merged_by" text;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_merged_into_id_financial_accounts_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."financial_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_merged_by_user_id_fk" FOREIGN KEY ("merged_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;