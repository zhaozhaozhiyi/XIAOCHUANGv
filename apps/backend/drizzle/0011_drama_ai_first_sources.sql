CREATE TABLE IF NOT EXISTS "drama_sources" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "source_type" varchar(50) DEFAULT 'paste' NOT NULL,
  "title" varchar(500),
  "content_hash" varchar(128) NOT NULL,
  "content" text NOT NULL,
  "word_count" integer DEFAULT 0 NOT NULL,
  "estimated_tokens" integer DEFAULT 0 NOT NULL,
  "chapter_count" integer DEFAULT 0 NOT NULL,
  "status" varchar(50) DEFAULT 'ready' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drama_sources_drama_id" ON "drama_sources" ("drama_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drama_sources_user_id" ON "drama_sources" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drama_sources_content_hash" ON "drama_sources" ("content_hash");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drama_source_chunks" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "source_id" integer NOT NULL REFERENCES "drama_sources"("id"),
  "chunk_no" integer NOT NULL,
  "chapter_no" integer,
  "title" varchar(500),
  "content_start" integer DEFAULT 0 NOT NULL,
  "content_end" integer DEFAULT 0 NOT NULL,
  "content_hash" varchar(128) NOT NULL,
  "estimated_tokens" integer DEFAULT 0 NOT NULL,
  "summary_payload" text,
  "extraction_payload" text,
  "source_trace" text,
  "status" varchar(50) DEFAULT 'pending' NOT NULL,
  "ai_run_id" varchar(128),
  "remote_run_id" varchar(128),
  "failure_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drama_source_chunks_source_id" ON "drama_source_chunks" ("source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drama_source_chunks_drama_id" ON "drama_source_chunks" ("drama_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drama_source_chunks_status" ON "drama_source_chunks" ("status");
