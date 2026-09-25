-- A switch may only name an activity of its own account: the key (activity_id, user_id) replaces the one on activity_id.
-- The previous API stays live while the PRE_DEPLOY job runs this, and the constraint changes lock both tables until the
-- commit. Waiting behind a long transaction would queue every tap behind this job, so give up after 5 s instead: the
-- deployment then fails and the previous API keeps serving; deploy again. Both tables are small, so once it holds the
-- locks the index build and the check of every switch take far less than that.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "switches" DROP CONSTRAINT "switches_activity_id_activities_id_fkey";--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_id_user_id_key" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "switches" ADD CONSTRAINT "switches_activity_user_fkey" FOREIGN KEY ("activity_id","user_id") REFERENCES "activities"("id","user_id") ON DELETE CASCADE;
