CREATE TABLE IF NOT EXISTS "writing_proposals" (
  "id" serial PRIMARY KEY NOT NULL,
  "writing_id" integer NOT NULL REFERENCES "writings"("id"),
  "user_id" integer REFERENCES "users"("id"),
  "source_run_id" integer REFERENCES "ai_runs"("id"),
  "proposal_kind" varchar(100) NOT NULL DEFAULT 'generic',
  "target_kind" varchar(50) NOT NULL DEFAULT 'proposal',
  "target_document_id" integer REFERENCES "writing_documents"("id"),
  "title" varchar(255) NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "structured_json" text,
  "references_json" text,
  "status" varchar(30) NOT NULL DEFAULT 'pending',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "applied_at" timestamp,
  "rejected_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_writing_proposals_writing_id_created_at"
  ON "writing_proposals" ("writing_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_writing_proposals_user_status"
  ON "writing_proposals" ("user_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "writing_knowledge_cards" (
  "id" serial PRIMARY KEY NOT NULL,
  "writing_id" integer NOT NULL REFERENCES "writings"("id"),
  "user_id" integer REFERENCES "users"("id"),
  "proposal_id" integer REFERENCES "writing_proposals"("id"),
  "card_type" varchar(50) NOT NULL,
  "title" varchar(255) NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "evidence_json" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_writing_knowledge_cards_writing_id_created_at"
  ON "writing_knowledge_cards" ("writing_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_writing_knowledge_cards_user_card_type"
  ON "writing_knowledge_cards" ("user_id", "card_type", "created_at");

CREATE TABLE IF NOT EXISTS "writing_object_histories" (
  "id" serial PRIMARY KEY NOT NULL,
  "writing_id" integer NOT NULL REFERENCES "writings"("id"),
  "user_id" integer REFERENCES "users"("id"),
  "object_kind" varchar(50) NOT NULL,
  "document_id" integer REFERENCES "writing_documents"("id"),
  "snapshot_title" varchar(255),
  "content" text NOT NULL DEFAULT '',
  "source_proposal_id" integer REFERENCES "writing_proposals"("id"),
  "source_run_id" integer REFERENCES "ai_runs"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_writing_object_histories_writing_kind_created_at"
  ON "writing_object_histories" ("writing_id", "object_kind", "created_at");
CREATE INDEX IF NOT EXISTS "idx_writing_object_histories_document_id_created_at"
  ON "writing_object_histories" ("document_id", "created_at");

CREATE TABLE IF NOT EXISTS "writing_knowledge_card_histories" (
  "id" serial PRIMARY KEY NOT NULL,
  "writing_id" integer NOT NULL REFERENCES "writings"("id"),
  "knowledge_card_id" integer NOT NULL REFERENCES "writing_knowledge_cards"("id"),
  "user_id" integer REFERENCES "users"("id"),
  "card_type" varchar(50) NOT NULL,
  "title" varchar(255) NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "evidence_json" text,
  "source_proposal_id" integer REFERENCES "writing_proposals"("id"),
  "source_run_id" integer REFERENCES "ai_runs"("id"),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_writing_knowledge_card_histories_card_created_at"
  ON "writing_knowledge_card_histories" ("knowledge_card_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_writing_knowledge_card_histories_writing_created_at"
  ON "writing_knowledge_card_histories" ("writing_id", "created_at");

CREATE TABLE IF NOT EXISTS "writing_batch_executions" (
  "id" serial PRIMARY KEY NOT NULL,
  "writing_id" integer NOT NULL REFERENCES "writings"("id"),
  "user_id" integer REFERENCES "users"("id"),
  "proposal_ids_json" text NOT NULL DEFAULT '[]',
  "recommended_proposal_ids_json" text NOT NULL DEFAULT '[]',
  "results_json" text NOT NULL DEFAULT '[]',
  "rollback_json" text NOT NULL DEFAULT '[]',
  "note" varchar(255),
  "tag" varchar(100),
  "is_pinned" boolean NOT NULL DEFAULT false,
  "is_important" boolean NOT NULL DEFAULT false,
  "applied_count" integer NOT NULL DEFAULT 0,
  "stopped_at_proposal_id" integer,
  "blocked_by_conflict" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_writing_batch_executions_writing_created_at"
  ON "writing_batch_executions" ("writing_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_writing_batch_executions_user_created_at"
  ON "writing_batch_executions" ("user_id", "created_at");
