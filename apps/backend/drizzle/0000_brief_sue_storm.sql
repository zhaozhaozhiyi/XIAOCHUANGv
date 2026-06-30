CREATE TABLE "agent_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"agent_type" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"model" varchar(255),
	"system_prompt" text,
	"temperature" real,
	"max_tokens" integer,
	"max_iterations" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_service_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"service_type" varchar(50) NOT NULL,
	"provider" varchar(100),
	"name" varchar(255) NOT NULL,
	"base_url" varchar(500) NOT NULL,
	"api_key" text NOT NULL,
	"model" varchar(255),
	"endpoint" varchar(500),
	"query_endpoint" varchar(500),
	"priority" integer DEFAULT 0,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"settings" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_voices" (
	"id" serial PRIMARY KEY NOT NULL,
	"voice_id" varchar(255) NOT NULL,
	"voice_name" varchar(255) NOT NULL,
	"description" text,
	"language" varchar(50),
	"provider" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_voices_voice_id_unique" UNIQUE("voice_id")
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"kind" varchar(50) DEFAULT 'image' NOT NULL,
	"title" varchar(255) NOT NULL,
	"provider" varchar(100),
	"mime_type" varchar(100),
	"source_type" varchar(50) DEFAULT 'legacy_asset' NOT NULL,
	"source_id" integer,
	"source_path" text,
	"drama_id" integer,
	"episode_id" integer,
	"storyboard_id" integer,
	"task_id" integer,
	"image_generation_id" integer,
	"video_generation_id" integer,
	"url" text,
	"local_path" text,
	"thumbnail_url" text,
	"metadata_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"session_token_hash" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "auth_sessions_session_token_hash_unique" UNIQUE("session_token_hash")
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"drama_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" varchar(100),
	"description" text,
	"appearance" text,
	"personality" text,
	"voice_style" varchar(100),
	"image_url" text,
	"reference_images" text,
	"seed_value" varchar(255),
	"sort_order" integer,
	"local_path" text,
	"voice_sample_url" text,
	"voice_provider" varchar(100),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "dramas" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"title" varchar(500) NOT NULL,
	"description" text,
	"genre" varchar(100),
	"style" varchar(100) DEFAULT 'realistic',
	"total_episodes" integer DEFAULT 0,
	"total_duration" integer DEFAULT 0,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"thumbnail" text,
	"tags" text,
	"metadata" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"review_status" varchar(50) DEFAULT 'pending',
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "episode_characters" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"character_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episode_scenes" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer NOT NULL,
	"scene_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"drama_id" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"content" text,
	"script_content" text,
	"description" text,
	"duration" integer DEFAULT 0,
	"status" varchar(50) DEFAULT 'draft',
	"video_url" text,
	"thumbnail" text,
	"image_config_id" integer,
	"video_config_id" integer,
	"audio_config_id" integer,
	"review_status" varchar(50) DEFAULT 'pending',
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "image_generations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"storyboard_id" integer,
	"drama_id" integer,
	"scene_id" integer,
	"character_id" integer,
	"prop_id" integer,
	"image_type" varchar(50),
	"frame_type" varchar(50),
	"provider" varchar(100),
	"prompt" text,
	"negative_prompt" text,
	"model" varchar(255),
	"size" varchar(50),
	"quality" varchar(50),
	"style" varchar(100),
	"steps" integer,
	"cfg_scale" real,
	"seed" integer,
	"image_url" text,
	"minio_url" text,
	"local_path" text,
	"status" varchar(50) DEFAULT 'pending',
	"task_id" varchar(255),
	"error_msg" text,
	"width" integer,
	"height" integer,
	"reference_images" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100),
	"plan" varchar(50) DEFAULT 'free' NOT NULL,
	"settings" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "phone_verification_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone" varchar(50) NOT NULL,
	"purpose" varchar(50) NOT NULL,
	"code" varchar(6) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "props" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"drama_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(100),
	"description" text,
	"prompt" text,
	"image_url" text,
	"reference_images" text,
	"local_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"level" integer DEFAULT 0 NOT NULL,
	"permissions" text,
	"is_system" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"drama_id" integer NOT NULL,
	"episode_id" integer,
	"location" varchar(500) NOT NULL,
	"time" varchar(100) NOT NULL,
	"prompt" text NOT NULL,
	"storyboard_count" integer DEFAULT 1,
	"image_url" text,
	"status" varchar(50) DEFAULT 'pending',
	"local_path" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "storyboard_characters" (
	"storyboard_id" integer NOT NULL,
	"character_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storyboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"episode_id" integer NOT NULL,
	"scene_id" integer,
	"storyboard_number" integer NOT NULL,
	"title" varchar(255),
	"location" varchar(500),
	"time" varchar(100),
	"shot_type" varchar(100),
	"angle" varchar(100),
	"movement" varchar(100),
	"action" text,
	"result" text,
	"atmosphere" text,
	"image_prompt" text,
	"video_prompt" text,
	"bgm_prompt" text,
	"sound_effect" text,
	"dialogue" text,
	"description" text,
	"duration" integer DEFAULT 0,
	"composed_image" text,
	"first_frame_image" text,
	"last_frame_image" text,
	"reference_images" text,
	"video_url" text,
	"tts_audio_url" text,
	"subtitle_url" text,
	"composed_video_url" text,
	"status" varchar(50) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"description" text,
	"price" integer DEFAULT 0 NOT NULL,
	"price_unit" varchar(20) DEFAULT 'month' NOT NULL,
	"video_quota_monthly" integer DEFAULT 0 NOT NULL,
	"image_quota_monthly" integer DEFAULT 0 NOT NULL,
	"storage_quota_mb" integer DEFAULT 0 NOT NULL,
	"ai_tokens_quota_monthly" integer DEFAULT 0 NOT NULL,
	"features" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"organization_id" integer,
	"plan_name" varchar(100) NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"title" varchar(255),
	"progress" integer,
	"source_type" varchar(50) NOT NULL,
	"drama_id" integer,
	"episode_id" integer,
	"storyboard_id" integer,
	"ai_config_id" integer,
	"domain_table" varchar(100) NOT NULL,
	"domain_id" integer NOT NULL,
	"provider_task_id" varchar(255),
	"attempt_count" integer DEFAULT 0,
	"locked_by" varchar(255),
	"locked_at" timestamp,
	"lock_expires_at" timestamp,
	"payload_json" text,
	"result_summary_json" text,
	"error_kind" varchar(50),
	"error_message" text,
	"error_details_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"role_id" integer NOT NULL,
	"granted_by" integer,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_user_id" varchar(255),
	"account_type" varchar(50) NOT NULL,
	"role" varchar(50) DEFAULT 'user' NOT NULL,
	"display_name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(50),
	"password_hash" varchar(255),
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "users_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "video_generations" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"storyboard_id" integer,
	"drama_id" integer,
	"provider" varchar(100),
	"prompt" text,
	"model" varchar(255),
	"image_gen_id" integer,
	"reference_mode" varchar(50),
	"image_url" text,
	"first_frame_url" text,
	"last_frame_url" text,
	"reference_image_urls" text,
	"duration" integer,
	"fps" integer,
	"resolution" varchar(50),
	"aspect_ratio" varchar(50),
	"style" varchar(100),
	"motion_level" integer,
	"camera_motion" varchar(100),
	"seed" integer,
	"video_url" text,
	"minio_url" text,
	"local_path" text,
	"status" varchar(50) DEFAULT 'pending',
	"task_id" varchar(255),
	"error_msg" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "video_merges" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"episode_id" integer,
	"drama_id" integer,
	"title" varchar(255),
	"provider" varchar(100),
	"model" varchar(255),
	"status" varchar(50) DEFAULT 'pending',
	"scenes" text,
	"merged_url" text,
	"duration" integer,
	"task_id" varchar(255),
	"error_msg" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "writing_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"writing_id" integer NOT NULL,
	"user_id" integer,
	"parent_id" integer,
	"title" varchar(255) NOT NULL,
	"document_type" varchar(50) DEFAULT 'chapter' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"content_md" text DEFAULT '' NOT NULL,
	"summary" text,
	"word_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "writings" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"title" varchar(255) NOT NULL,
	"kind" varchar(50) DEFAULT 'novel' NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"synopsis" text,
	"outline_json" text,
	"current_document_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_service_configs" ADD CONSTRAINT "ai_service_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_drama_id_dramas_id_fk" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_image_generation_id_image_generations_id_fk" FOREIGN KEY ("image_generation_id") REFERENCES "public"."image_generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_video_generation_id_video_generations_id_fk" FOREIGN KEY ("video_generation_id") REFERENCES "public"."video_generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_drama_id_dramas_id_fk" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dramas" ADD CONSTRAINT "dramas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_characters" ADD CONSTRAINT "episode_characters_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_characters" ADD CONSTRAINT "episode_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_scenes" ADD CONSTRAINT "episode_scenes_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episode_scenes" ADD CONSTRAINT "episode_scenes_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_drama_id_dramas_id_fk" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_image_config_id_ai_service_configs_id_fk" FOREIGN KEY ("image_config_id") REFERENCES "public"."ai_service_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_video_config_id_ai_service_configs_id_fk" FOREIGN KEY ("video_config_id") REFERENCES "public"."ai_service_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_audio_config_id_ai_service_configs_id_fk" FOREIGN KEY ("audio_config_id") REFERENCES "public"."ai_service_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_drama_id_dramas_id_fk" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generations" ADD CONSTRAINT "image_generations_prop_id_props_id_fk" FOREIGN KEY ("prop_id") REFERENCES "public"."props"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "props" ADD CONSTRAINT "props_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "props" ADD CONSTRAINT "props_drama_id_dramas_id_fk" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_drama_id_dramas_id_fk" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_characters" ADD CONSTRAINT "storyboard_characters_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboard_characters" ADD CONSTRAINT "storyboard_characters_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storyboards" ADD CONSTRAINT "storyboards_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_name_subscription_plans_name_fk" FOREIGN KEY ("plan_name") REFERENCES "public"."subscription_plans"("name") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_drama_id_dramas_id_fk" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_ai_config_id_ai_service_configs_id_fk" FOREIGN KEY ("ai_config_id") REFERENCES "public"."ai_service_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_storyboard_id_storyboards_id_fk" FOREIGN KEY ("storyboard_id") REFERENCES "public"."storyboards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_drama_id_dramas_id_fk" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_generations" ADD CONSTRAINT "video_generations_image_gen_id_image_generations_id_fk" FOREIGN KEY ("image_gen_id") REFERENCES "public"."image_generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_merges" ADD CONSTRAINT "video_merges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_merges" ADD CONSTRAINT "video_merges_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_merges" ADD CONSTRAINT "video_merges_drama_id_dramas_id_fk" FOREIGN KEY ("drama_id") REFERENCES "public"."dramas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_documents" ADD CONSTRAINT "writing_documents_writing_id_writings_id_fk" FOREIGN KEY ("writing_id") REFERENCES "public"."writings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_documents" ADD CONSTRAINT "writing_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writings" ADD CONSTRAINT "writings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_assets_user_id_updated_at" ON "assets" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "idx_assets_drama_id" ON "assets" USING btree ("drama_id");--> statement-breakpoint
CREATE INDEX "idx_assets_task_id" ON "assets" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_user_id" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_org_members" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_org_members_org_id" ON "organization_members" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_org_members_user_id" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_organizations_slug" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_phone_verification_codes_lookup" ON "phone_verification_codes" USING btree ("phone","purpose");--> statement-breakpoint
CREATE INDEX "idx_phone_verification_codes_expires_at" ON "phone_verification_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subscription_plans_name" ON "subscription_plans" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subscriptions_user_id" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_status" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_tasks_status_updated_at" ON "tasks" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "idx_tasks_source_type" ON "tasks" USING btree ("source_type","type");--> statement-breakpoint
CREATE INDEX "idx_tasks_user_id_updated_at" ON "tasks" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_phone" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_writing_documents_writing_id_sort_order" ON "writing_documents" USING btree ("writing_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_writings_user_id_updated_at" ON "writings" USING btree ("user_id","updated_at");