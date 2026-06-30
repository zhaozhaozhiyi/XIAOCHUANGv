-- 画布模块 v1.0.0 · 数据库 Migration
-- 所有 canvas 表使用 text UUID PK（前端生成），user_id 为 integer FK

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvases" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(100) NOT NULL DEFAULT '未命名画布',
  "source" varchar(50) NOT NULL DEFAULT 'blank',
  "is_pinned" boolean NOT NULL DEFAULT false,
  "sort_order" integer NOT NULL DEFAULT 0,
  "color_palette_json" text NOT NULL DEFAULT '[]',
  "composite_settings_json" text NOT NULL DEFAULT '{"resolution":"1080p","fps":24,"transition":"none"}',
  "current_version_id" text,
  "thumbnail" text,
  "source_drama_id" text,
  "source_episode_id" text,
  "source_drama_title" text,
  "source_drama_snapshot_at" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvases_user_id" ON "canvases"("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvases_user_pinned" ON "canvases"("user_id", "is_pinned");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvases_deleted_at" ON "canvases"("deleted_at");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_nodes" (
  "id" text PRIMARY KEY NOT NULL,
  "canvas_id" text NOT NULL REFERENCES "canvases"("id") ON DELETE CASCADE,
  "version_id" text,
  "node_def_id" varchar(50) NOT NULL,
  "label" varchar(100) NOT NULL DEFAULT '',
  "data_json" text NOT NULL DEFAULT '{}',
  "position_x" real NOT NULL DEFAULT 0,
  "position_y" real NOT NULL DEFAULT 0,
  "width" integer NOT NULL DEFAULT 260,
  "height" integer NOT NULL DEFAULT 230,
  "z_index" integer NOT NULL DEFAULT 0,
  "color" varchar(10),
  "shot_index" integer,
  "parent_storyboard_id" text,
  "is_hidden" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_nodes_canvas_id" ON "canvas_nodes"("canvas_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_nodes_version_id" ON "canvas_nodes"("version_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_nodes_position" ON "canvas_nodes"("canvas_id", "position_x", "position_y");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_nodes_def_id" ON "canvas_nodes"("canvas_id", "node_def_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_edges" (
  "id" text PRIMARY KEY NOT NULL,
  "canvas_id" text NOT NULL REFERENCES "canvases"("id") ON DELETE CASCADE,
  "source_node_id" text NOT NULL,
  "target_node_id" text NOT NULL,
  "edge_kind" varchar(20) NOT NULL DEFAULT 'narrative',
  "relation_type" varchar(20),
  "thickness" varchar(10),
  "source_port" varchar(50),
  "target_port" varchar(50),
  "label" varchar(50),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_edges_canvas_id" ON "canvas_edges"("canvas_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_edges_source" ON "canvas_edges"("canvas_id", "source_node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_edges_target" ON "canvas_edges"("canvas_id", "target_node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_edges_kind" ON "canvas_edges"("canvas_id", "edge_kind");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_viewports" (
  "id" text PRIMARY KEY NOT NULL,
  "canvas_id" text NOT NULL UNIQUE REFERENCES "canvases"("id") ON DELETE CASCADE,
  "x" real NOT NULL DEFAULT 0,
  "y" real NOT NULL DEFAULT 0,
  "zoom" real NOT NULL DEFAULT 1.0,
  "info_layers_json" text NOT NULL DEFAULT '{"emotion":false,"rhythm":false,"shotType":false,"ai":false}',
  "updated_at" timestamp NOT NULL DEFAULT now()
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "canvas_id" text NOT NULL REFERENCES "canvases"("id") ON DELETE CASCADE,
  "type" varchar(20) NOT NULL,
  "label" varchar(100),
  "run_id" text,
  "node_count" integer NOT NULL DEFAULT 0,
  "edge_count" integer NOT NULL DEFAULT 0,
  "thumbnail" text,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_versions_canvas_id" ON "canvas_versions"("canvas_id", "type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_versions_run_id" ON "canvas_versions"("run_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_version_nodes" (
  "id" text PRIMARY KEY NOT NULL,
  "version_id" text NOT NULL REFERENCES "canvas_versions"("id") ON DELETE CASCADE,
  "original_node_id" text NOT NULL,
  "node_def_id" varchar(50) NOT NULL,
  "label" varchar(100) NOT NULL DEFAULT '',
  "data_json" text NOT NULL DEFAULT '{}',
  "position_x" real NOT NULL DEFAULT 0,
  "position_y" real NOT NULL DEFAULT 0,
  "width" integer NOT NULL DEFAULT 260,
  "height" integer NOT NULL DEFAULT 230,
  "z_index" integer NOT NULL DEFAULT 0,
  "shot_index" integer,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_version_nodes_version_id" ON "canvas_version_nodes"("version_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_version_edges" (
  "id" text PRIMARY KEY NOT NULL,
  "version_id" text NOT NULL REFERENCES "canvas_versions"("id") ON DELETE CASCADE,
  "original_edge_id" text NOT NULL,
  "source_node_id" text NOT NULL,
  "target_node_id" text NOT NULL,
  "edge_kind" varchar(20) NOT NULL DEFAULT 'narrative',
  "relation_type" varchar(20),
  "thickness" varchar(10),
  "source_port" varchar(50),
  "target_port" varchar(50),
  "label" varchar(50),
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_version_edges_version_id" ON "canvas_version_edges"("version_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "canvas_id" text NOT NULL REFERENCES "canvases"("id") ON DELETE CASCADE,
  "version_id" text NOT NULL REFERENCES "canvas_versions"("id") ON DELETE CASCADE,
  "status" varchar(30) NOT NULL DEFAULT 'pending',
  "total_nodes" integer NOT NULL DEFAULT 0,
  "completed_nodes" integer NOT NULL DEFAULT 0,
  "failed_nodes" integer NOT NULL DEFAULT 0,
  "skipped_nodes" integer NOT NULL DEFAULT 0,
  "progress" real NOT NULL DEFAULT 0,
  "credits_consumed" real NOT NULL DEFAULT 0,
  "error_message" text,
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_runs_canvas_id" ON "canvas_runs"("canvas_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_runs_status" ON "canvas_runs"("status");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL REFERENCES "canvas_runs"("id") ON DELETE CASCADE,
  "canvas_id" text NOT NULL REFERENCES "canvases"("id") ON DELETE CASCADE,
  "node_id" text NOT NULL,
  "node_def_id" varchar(50) NOT NULL,
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "params_json" text NOT NULL DEFAULT '{}',
  "result_json" text,
  "error_message" text,
  "error_code" varchar(50),
  "progress" real NOT NULL DEFAULT 0,
  "retry_count" integer NOT NULL DEFAULT 0,
  "max_retries" integer NOT NULL DEFAULT 3,
  "bullmq_job_id" varchar(255),
  "started_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_tasks_run_id" ON "canvas_tasks"("run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_tasks_canvas_id" ON "canvas_tasks"("canvas_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_tasks_node_id" ON "canvas_tasks"("node_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_canvas_tasks_status" ON "canvas_tasks"("status");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "canvas_custom_terms" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id"),
  "field_type" varchar(20) NOT NULL,
  "term" varchar(100) NOT NULL,
  "use_count" integer NOT NULL DEFAULT 1,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_canvas_custom_terms_user_field_term" ON "canvas_custom_terms"("user_id", "field_type", "term");
