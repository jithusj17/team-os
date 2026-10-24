ALTER TABLE "search_index" drop column "tsv";--> statement-breakpoint
ALTER TABLE "search_index" ADD COLUMN "tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('simple', title), 'A') || setweight(to_tsvector('english', content), 'B') || setweight(to_tsvector('simple', content), 'B')) STORED NOT NULL;--> statement-breakpoint
-- Dropping the column dropped its index; recreate it.
CREATE INDEX "search_index_tsv_idx" ON "search_index" USING gin ("tsv");
