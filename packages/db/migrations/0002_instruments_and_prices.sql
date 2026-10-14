CREATE TYPE "public"."price_source" AS ENUM('statement', 'csv', 'manual');--> statement-breakpoint
CREATE TYPE "public"."price_status" AS ENUM('active', 'conflict', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."price_type" AS ENUM('daily', 'trade', 'manual');--> statement-breakpoint
CREATE TABLE "instrument_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"symbol" text NOT NULL,
	"exchange" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"isin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"observed_on" date NOT NULL,
	"price" numeric(24, 8) NOT NULL,
	"currency" text NOT NULL,
	"price_type" "price_type" NOT NULL,
	"source" "price_source" NOT NULL,
	"source_file_id" uuid,
	"source_row" integer,
	"status" "price_status" DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD COLUMN "instrument_id" uuid;--> statement-breakpoint
ALTER TABLE "instrument_aliases" ADD CONSTRAINT "instrument_aliases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_aliases" ADD CONSTRAINT "instrument_aliases_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instrument_aliases_uq" ON "instrument_aliases" USING btree ("workspace_id","alias");--> statement-breakpoint
CREATE UNIQUE INDEX "instruments_symbol_uq" ON "instruments" USING btree ("workspace_id","exchange","symbol");--> statement-breakpoint
CREATE INDEX "price_observations_instrument_idx" ON "price_observations" USING btree ("instrument_id","observed_on");--> statement-breakpoint
CREATE INDEX "price_observations_file_idx" ON "price_observations" USING btree ("source_file_id");--> statement-breakpoint
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;