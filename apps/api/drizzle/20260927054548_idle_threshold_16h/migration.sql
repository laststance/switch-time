-- 12 h (720) treated a recorded 12 h 34 m sleep as idle: the 24 h bar dashed it and the totals dropped it.
-- The default becomes 16 h (960). Accounts still stored at 720 move with it (that value is both the old default and the 12h button). A chosen 6 h, 8 h or 10 h stays.
-- ALTER COLUMN SET DEFAULT takes a brief exclusive lock. Each lock waits at most 5 s and each statement at most 10 s, or the deploy fails and the previous default keeps serving.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '10s';--> statement-breakpoint
ALTER TABLE "user_settings" ALTER COLUMN "idle_threshold_minutes" SET DEFAULT 960;--> statement-breakpoint
UPDATE "user_settings" SET "idle_threshold_minutes" = 960 WHERE "idle_threshold_minutes" = 720;--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;--> statement-breakpoint
SET LOCAL statement_timeout = DEFAULT;
