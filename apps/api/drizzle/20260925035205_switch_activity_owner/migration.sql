-- A switch may only name an activity of its own account: the key (activity_id, user_id) replaces the one on activity_id.
-- The previous API stays live while the PRE_DEPLOY job runs this, and the constraint changes hold both tables, reads
-- included, until the commit. Waiting behind a long transaction would queue every tap behind this job, so each lock waits
-- at most 5 s (up to 10 s for the two); past that the deployment fails and the previous API keeps serving: deploy again.
-- The locks are taken up front in switchTo's order (activities, then switches), so the most frequent write cannot deadlock
-- with them; a correction that reads switches first still can, and the deadlock check then aborts one side after 1 s.
-- Once held, the index build and the check of every switch take milliseconds at this size; statement_timeout caps each
-- statement at 10 s all the same, so a slow disk fails the deployment rather than stalling every account behind it. The
-- online route (CREATE INDEX CONCURRENTLY, then NOT VALID and VALIDATE in a later transaction) needs statements outside
-- one transaction, and the migrator runs every pending migration in one.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '10s';--> statement-breakpoint
LOCK TABLE "activities", "switches" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE "switches" DROP CONSTRAINT "switches_activity_id_activities_id_fkey";--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_id_user_id_key" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "switches" ADD CONSTRAINT "switches_activity_user_fkey" FOREIGN KEY ("activity_id","user_id") REFERENCES "activities"("id","user_id") ON DELETE CASCADE;--> statement-breakpoint
-- Every pending migration runs in one transaction, so hand the ones after this back their usual waits.
SET LOCAL lock_timeout = DEFAULT;--> statement-breakpoint
SET LOCAL statement_timeout = DEFAULT;
