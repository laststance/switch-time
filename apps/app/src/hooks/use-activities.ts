import { useQuery } from '@tanstack/react-query'

import { orpc } from '@/lib/orpc'

type ActivityRow = Awaited<ReturnType<typeof orpc.activities.list.call>>[number]

// Archived rows stay in the list so History can name them; the switch row and the hotkeys only see live ones.
const selectLive = (rows: ActivityRow[]) =>
  rows.filter((row) => row.archivedAt === null)

/**
 * The user's live activities in `position` order (the switch row, the first-launch row, the digit hotkeys, the rail badge).
 * @example const activities = useActivities().data ?? []
 */
export function useActivities() {
  return useQuery(orpc.activities.list.queryOptions({ select: selectLive }))
}
