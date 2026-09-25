import { ACTIVITY_PALETTE, THEME_MODES } from '@switch-time/shared'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { user } from './auth'

export const switchSource = pgEnum('switch_source', [
  'tap',
  'correction',
  'split',
  'merge',
])
export const excludedDayReason = pgEnum('excluded_day_reason', [
  'auto_unused',
  'manual',
])
export const themeMode = pgEnum('theme_mode', THEME_MODES)

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 20 }).notNull(),
    color: text('color').notNull(),
    iconKey: text('icon_key').notNull(),
    // 「1日の目安」; null = no target (no ring / target line).
    targetHours: numeric('target_hours', {
      precision: 4,
      scale: 2,
      mode: 'number',
    }),
    // The menubar derives ⌘1–6 from this; the shortcut label itself is never stored.
    position: integer('position').notNull(),
    archivedAt: timestamptz('archived_at'),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Only active rows compete for a slot: archiving frees the position without renumbering the rest.
    uniqueIndex('activities_user_position_idx')
      .on(table.userId, table.position)
      .where(sql`${table.archivedAt} is null`),
    // The database refuses colours outside the design palette even when a client bypasses the Zod schema.
    check(
      'activities_color_palette',
      sql.raw(
        `color in (${ACTIVITY_PALETTE.map((hex) => `'${hex}'`).join(', ')})`,
      ),
    ),
    // The target of switches' (activity_id, user_id) key: a switch can only name an activity of its own account.
    unique('activities_id_user_id_key').on(table.id, table.userId),
  ],
)

export const switches = pgTable(
  'switches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // null = detox: the state is "no activity", and the time until the next row is recorded to nothing.
    activityId: uuid('activity_id'),
    // No end time: a segment lasts until the next row (or now); the latest row is the current state.
    startedAt: timestamptz('started_at').notNull(),
    source: switchSource('source').default('tap').notNull(),
    // Bumped by every write that changes the row's activity or its span (its start, or where the next row starts), so a
    // write that names the revision it saw is refused once another write reshaped the record (changeActivity's `revision`).
    revision: integer('revision').default(0).notNull(),
    // A detox row that starts a new detox run although the row before it is detox too: switchTo sets it on a detox re-tap
    // past the run's measured week. Edits keep it and 「元に戻す」 writes it back, so a cut (a detox row without it) never renews.
    startsRun: boolean('starts_run').default(false).notNull(),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [
    // Unique: two switches of one account never start at the same instant, so every read of the timeline orders it the same
    // way. NULLS FIRST matches the queries' desc()/asc() sort order, so the index serves them without a sort.
    uniqueIndex('switches_user_started_idx').on(
      table.userId,
      table.startedAt.desc().nullsFirst(),
    ),
    // The rows that bound a detox run (an activity, or a detox that starts a run): `current` finds the running run's start
    // from the latest of them without walking the account's whole history.
    index('switches_run_boundary_idx')
      .on(table.userId, table.startedAt.desc().nullsFirst())
      .where(sql`${table.activityId} is not null or ${table.startsRun}`),
    // The activity must belong to the switch's own account, whatever route writes it (not only those that check it). A null
    // activity (detox) passes: MATCH SIMPLE skips the check when any column of the key is null.
    foreignKey({
      name: 'switches_activity_user_fkey',
      columns: [table.activityId, table.userId],
      foreignColumns: [activities.id, activities.userId],
    }).onDelete('cascade'),
  ],
)

export const excludedDays = pgTable(
  'excluded_days',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    day: date('day', { mode: 'string' }).notNull(),
    // Only `manual` rows are stored; `auto_unused` days are computed when stats are read.
    reason: excludedDayReason('reason').notNull(),
    createdAt: timestamptz('created_at').defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
)

export const userSettings = pgTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  theme: themeMode('theme').default('auto').notNull(),
  showSecondHand: boolean('show_second_hand').default(true).notNull(),
  // 無操作とみなす時間: a segment longer than this is left out of totals. 12h sits above the 8h work / 7h sleep targets.
  idleThresholdMinutes: integer('idle_threshold_minutes')
    .default(720)
    .notNull(),
  autoExcludeUnusedDays: boolean('auto_exclude_unused_days')
    .default(true)
    .notNull(),
  // IANA zone every day boundary is computed in; the client syncs its own zone into it (settings.update).
  timeZone: text('time_zone').default('Asia/Tokyo').notNull(),
  createdAt: timestamptz('created_at').defaultNow().notNull(),
  updatedAt: timestamptz('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
})
