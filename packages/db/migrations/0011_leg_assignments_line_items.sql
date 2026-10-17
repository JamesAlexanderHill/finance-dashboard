CREATE TYPE "public"."leg_assignment_kind" AS ENUM('category', 'tags');--> statement-breakpoint
CREATE TABLE "leg_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"workspace_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"leg_key" text NOT NULL,
	"kind" "leg_assignment_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"supersedes_id" uuid,
	"actor" "decision_actor" DEFAULT 'user' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leg_assignments_seq_unique" UNIQUE("seq")
);
--> statement-breakpoint
CREATE TABLE "transaction_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"amount" numeric(24, 8) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leg_assignments" ADD CONSTRAINT "leg_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leg_assignments" ADD CONSTRAINT "leg_assignments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leg_assignments" ADD CONSTRAINT "leg_assignments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_line_items" ADD CONSTRAINT "transaction_line_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_line_items" ADD CONSTRAINT "transaction_line_items_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_line_items" ADD CONSTRAINT "transaction_line_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leg_assignments_leg_idx" ON "leg_assignments" USING btree ("transaction_id","leg_key","kind","seq");--> statement-breakpoint
CREATE INDEX "transaction_line_items_transaction_idx" ON "transaction_line_items" USING btree ("transaction_id","position");--> statement-breakpoint
-- Data: the current itemisation of each transaction becomes its line items (ADR 0014).
INSERT INTO "transaction_line_items" ("workspace_id", "transaction_id", "position", "amount", "description", "created_by", "created_at")
SELECT d.workspace_id, d.transaction_id, (l.ord - 1)::int, (l.line->>'amount')::numeric, coalesce(l.line->>'description', ''), d.created_by, d.created_at
FROM (
  SELECT DISTINCT ON (transaction_id) workspace_id, transaction_id, payload, created_by, created_at
  FROM "reconciliation_decisions" WHERE kind = 'itemisation' ORDER BY transaction_id, seq DESC
) d
CROSS JOIN LATERAL jsonb_array_elements(d.payload->'lines') WITH ORDINALITY AS l(line, ord)
WHERE jsonb_typeof(d.payload->'lines') = 'array';--> statement-breakpoint
-- Data: current category and tag decisions become leg assignments; `line:<index>` keys now name the line item.
INSERT INTO "leg_assignments" ("workspace_id", "transaction_id", "leg_key", "kind", "payload", "actor", "created_by", "created_at")
SELECT d.workspace_id, d.transaction_id,
  CASE WHEN d.leg_key LIKE 'line:%' THEN 'line:' || li.id::text ELSE d.leg_key END,
  d.kind::text::"leg_assignment_kind", d.payload, d.actor, d.created_by, d.created_at
FROM (
  SELECT DISTINCT ON (transaction_id, kind, leg_key) *
  FROM "reconciliation_decisions" WHERE kind IN ('category', 'tags') ORDER BY transaction_id, kind, leg_key, seq DESC
) d
LEFT JOIN "transaction_line_items" li
  ON li.transaction_id = d.transaction_id AND li.position = (CASE WHEN d.leg_key ~ '^line:[0-9]+$' THEN substring(d.leg_key from 6)::int END)
WHERE d.leg_key NOT LIKE 'line:%' OR li.id IS NOT NULL
ORDER BY d.seq;
