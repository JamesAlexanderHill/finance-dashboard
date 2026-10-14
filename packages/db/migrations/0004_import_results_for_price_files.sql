ALTER TABLE "import_results" ALTER COLUMN "statement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "import_results" ADD COLUMN "source_file_id" uuid;--> statement-breakpoint
ALTER TABLE "import_results" ADD CONSTRAINT "import_results_source_file_id_source_files_id_fk" FOREIGN KEY ("source_file_id") REFERENCES "public"."source_files"("id") ON DELETE no action ON UPDATE no action;