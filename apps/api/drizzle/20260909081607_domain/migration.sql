CREATE TYPE "excluded_day_reason" AS ENUM('auto_unused', 'manual');--> statement-breakpoint
CREATE TYPE "switch_source" AS ENUM('tap', 'correction', 'split', 'merge');--> statement-breakpoint
CREATE TYPE "theme_mode" AS ENUM('auto', 'light', 'dark');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"name" varchar(20) NOT NULL,
	"color" text NOT NULL,
	"icon_key" text NOT NULL,
	"target_hours" numeric(4,2),
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_color_palette" CHECK (color in ('#E0A431', '#3B7BD9', '#4FA877', '#6C63D6', '#E0684A', '#D8579C', '#2BA3B5', '#8A6A4B'))
);
--> statement-breakpoint
CREATE TABLE "excluded_days" (
	"user_id" text,
	"day" date,
	"reason" "excluded_day_reason" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "excluded_days_pkey" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "switches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"activity_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"source" "switch_source" DEFAULT 'tap'::"switch_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY,
	"theme" "theme_mode" DEFAULT 'auto'::"theme_mode" NOT NULL,
	"show_second_hand" boolean DEFAULT true NOT NULL,
	"idle_threshold_minutes" integer DEFAULT 720 NOT NULL,
	"auto_exclude_unused_days" boolean DEFAULT true NOT NULL,
	"time_zone" text DEFAULT 'Asia/Tokyo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "activities_user_position_idx" ON "activities" ("user_id","position") WHERE "archived_at" is null;--> statement-breakpoint
CREATE INDEX "switches_user_started_idx" ON "switches" ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "excluded_days" ADD CONSTRAINT "excluded_days_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "switches" ADD CONSTRAINT "switches_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "switches" ADD CONSTRAINT "switches_activity_id_activities_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;