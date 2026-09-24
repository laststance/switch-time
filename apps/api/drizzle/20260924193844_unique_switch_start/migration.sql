-- Spread any switches of one account that start at the same instant 1 ms apart before the unique index below refuses them.
-- Taps from two devices could land in the same millisecond before switchTo started each switch after the last. Each row
-- starts at the later of its own start and 1 ms after the row before it (in start, then insertion order, so the later tap
-- stays the later switch): `n ms + max(start - k ms)` over the rows up to the n-th. A tie next to a row already 1 ms later
-- pushes that row on too, instead of landing on it. Forward-only: the original tied instants are not kept.
-- The previous API stays live while the PRE_DEPLOY job runs this, in one transaction: the lock holds its writes (reads go on)
-- from before the spread reads the table until the unique index is built, so no tap or correction lands in between, where
-- the spread would overwrite it or a new tie would fail the index.
LOCK TABLE "switches" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
WITH "ranked" AS (
  SELECT "id", "user_id", "started_at",
    (row_number() OVER (PARTITION BY "user_id" ORDER BY "started_at", "created_at", "id") - 1)
      * interval '1 millisecond' AS "rank_ms"
  FROM "switches"
), "spread" AS (
  SELECT "id", "started_at",
    "rank_ms" + max("started_at" - "rank_ms") OVER (
      PARTITION BY "user_id" ORDER BY "rank_ms" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS "spread_at"
  FROM "ranked"
)
UPDATE "switches" SET "started_at" = "spread"."spread_at"
FROM "spread"
WHERE "switches"."id" = "spread"."id" AND "spread"."spread_at" <> "spread"."started_at";--> statement-breakpoint
DROP INDEX "switches_user_started_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "switches_user_started_idx" ON "switches" ("user_id","started_at" DESC);
