CREATE TABLE "search_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"task_id" uuid,
	"chunk_index" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"allowed_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"content_hash" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', content), 'B')) STORED NOT NULL,
	"embedding" vector(1024),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_index" ADD CONSTRAINT "search_index_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "search_index_source_chunk_idx" ON "search_index" USING btree ("source_type","source_id","chunk_index");--> statement-breakpoint
CREATE INDEX "search_index_workspace_idx" ON "search_index" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "search_index_task_idx" ON "search_index" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "search_index_tsv_idx" ON "search_index" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "search_index_embedding_idx" ON "search_index" USING hnsw ("embedding" vector_cosine_ops);