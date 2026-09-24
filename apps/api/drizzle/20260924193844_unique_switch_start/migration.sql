-- Spread any switches of one account that start at the same instant 1 ms apart, in id order, before the unique index below
-- refuses them. Taps from two devices could land in the same millisecond before switchTo started each switch after the last.
WITH "tied" AS (
  SELECT "id", row_number() OVER (PARTITION BY "user_id", "started_at" ORDER BY "id") - 1 AS "offset_ms"
  FROM "switches"
)
UPDATE "switches" SET "started_at" = "switches"."started_at" + "tied"."offset_ms" * interval '1 millisecond'
FROM "tied"
WHERE "switches"."id" = "tied"."id" AND "tied"."offset_ms" > 0;--> statement-breakpoint
DROP INDEX "switches_user_started_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "switches_user_started_idx" ON "switches" ("user_id","started_at" DESC);
