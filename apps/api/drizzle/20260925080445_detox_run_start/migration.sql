-- A detox re-tap past the run's measured week starts a new run: `starts_run` marks that row, and the partial index finds
-- the latest run boundary (an activity, or such a row) without reading the account's whole history. Every existing row
-- keeps false, so every existing run reads as before.
-- The previous API stays live while the PRE_DEPLOY job runs this. The constant default makes ADD COLUMN a catalogue change,
-- and the index build reads the table once; each still holds writes to switches until the commit, so each lock waits at
-- most 5 s and each statement runs at most 10 s: past that the deployment fails and the previous API keeps serving.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '10s';--> statement-breakpoint
ALTER TABLE "switches" ADD COLUMN "starts_run" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "switches_run_boundary_idx" ON "switches" ("user_id","started_at" DESC) WHERE "activity_id" is not null or "starts_run";--> statement-breakpoint
-- Every pending migration runs in one transaction, so hand the ones after this back their usual waits.
SET LOCAL lock_timeout = DEFAULT;--> statement-breakpoint
SET LOCAL statement_timeout = DEFAULT;
