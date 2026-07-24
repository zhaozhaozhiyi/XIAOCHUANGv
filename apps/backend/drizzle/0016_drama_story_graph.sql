CREATE TABLE IF NOT EXISTS "drama_story_graphs" (
  "id" serial PRIMARY KEY,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "source_id" integer REFERENCES "drama_sources"("id"),
  "source_hash" varchar(128),
  "graph_basis" varchar(50) NOT NULL DEFAULT 'script',
  "script_hash" varchar(128) NOT NULL,
  "episode_scope_json" text NOT NULL DEFAULT '[]',
  "version" integer NOT NULL DEFAULT 1,
  "status" varchar(50) NOT NULL DEFAULT 'pending',
  "build_mode" varchar(50) NOT NULL DEFAULT 'from_script',
  "stats_json" text NOT NULL DEFAULT '{}',
  "summary_json" text NOT NULL DEFAULT '{}',
  "task_id" integer REFERENCES "tasks"("id"),
  "ai_run_id" varchar(128),
  "failure_reason" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_drama_story_graphs_active"
  ON "drama_story_graphs"("drama_id")
  WHERE "deleted_at" IS NULL AND "status" IN ('building', 'ready');

CREATE TABLE IF NOT EXISTS "drama_graph_entities" (
  "id" serial PRIMARY KEY,
  "graph_id" integer NOT NULL REFERENCES "drama_story_graphs"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "entity_type" varchar(50) NOT NULL,
  "canonical_name" varchar(255) NOT NULL,
  "display_name" varchar(255),
  "role" varchar(100),
  "description" text,
  "attributes_json" text NOT NULL DEFAULT '{}',
  "importance" real DEFAULT 0,
  "first_seen_json" text NOT NULL DEFAULT '{}',
  "source_trace_json" text NOT NULL DEFAULT '[]',
  "linked_character_id" integer REFERENCES "characters"("id"),
  "linked_scene_id" integer REFERENCES "scenes"("id"),
  "linked_prop_id" integer REFERENCES "props"("id"),
  "seed_status" varchar(50) NOT NULL DEFAULT 'pending',
  "seed_conflict_json" text NOT NULL DEFAULT '{}',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_drama_graph_entities_graph_type"
  ON "drama_graph_entities"("graph_id", "entity_type");

CREATE INDEX IF NOT EXISTS "idx_drama_graph_entities_drama_name"
  ON "drama_graph_entities"("drama_id", "canonical_name");

CREATE TABLE IF NOT EXISTS "drama_graph_relations" (
  "id" serial PRIMARY KEY,
  "graph_id" integer NOT NULL REFERENCES "drama_story_graphs"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "subject_entity_id" integer NOT NULL REFERENCES "drama_graph_entities"("id"),
  "object_entity_id" integer NOT NULL REFERENCES "drama_graph_entities"("id"),
  "relation_type" varchar(100) NOT NULL,
  "predicate" varchar(255) NOT NULL,
  "polarity" varchar(30),
  "strength" real DEFAULT 0.5,
  "description" text,
  "evidence_json" text NOT NULL DEFAULT '[]',
  "valid_from_json" text,
  "valid_to_json" text,
  "source_trace_json" text NOT NULL DEFAULT '[]',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_drama_graph_relations_graph"
  ON "drama_graph_relations"("graph_id");

CREATE TABLE IF NOT EXISTS "drama_entity_aliases" (
  "id" serial PRIMARY KEY,
  "graph_id" integer NOT NULL REFERENCES "drama_story_graphs"("id"),
  "entity_id" integer NOT NULL REFERENCES "drama_graph_entities"("id"),
  "alias" varchar(255) NOT NULL,
  "alias_type" varchar(50) NOT NULL DEFAULT 'title',
  "evidence_json" text NOT NULL DEFAULT '[]',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_drama_entity_aliases_entity_alias"
  ON "drama_entity_aliases"("graph_id", "entity_id", "alias");

CREATE TABLE IF NOT EXISTS "drama_graph_events" (
  "id" serial PRIMARY KEY,
  "graph_id" integer NOT NULL REFERENCES "drama_story_graphs"("id"),
  "drama_id" integer NOT NULL REFERENCES "dramas"("id"),
  "event_type" varchar(50) NOT NULL,
  "title" varchar(500) NOT NULL,
  "summary" text,
  "episode_id" integer REFERENCES "episodes"("id"),
  "episode_number" integer,
  "script_span_start" integer,
  "script_span_end" integer,
  "scene_ref_json" text NOT NULL DEFAULT '{}',
  "involved_entity_ids_json" text NOT NULL DEFAULT '[]',
  "emotional_tone" varchar(100),
  "importance" real DEFAULT 0.5,
  "evidence_json" text NOT NULL DEFAULT '[]',
  "source_chunk_id" integer REFERENCES "drama_source_chunks"("id"),
  "source_trace_json" text NOT NULL DEFAULT '[]',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_drama_graph_events_graph_episode"
  ON "drama_graph_events"("graph_id", "episode_number");
