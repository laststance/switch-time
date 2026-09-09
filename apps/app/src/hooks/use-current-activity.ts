import { useQuery } from '@tanstack/react-query'

import { orpc } from '@/lib/orpc'

import { useActivities } from './use-activities'

/**
 * The current state (latest switch) joined with its activity; `current` is null before the very first tap, which is the first-launch case.
 * @example const { current, activity, isPending } = useCurrentActivity()
 */
export function useCurrentActivity() {
  const current = useQuery(orpc.switches.current.queryOptions())
  const activities = useActivities()
  const activity =
    activities.data?.find((row) => row.id === current.data?.activityId) ?? null
  return {
    current: current.data ?? null,
    activity,
    // No trustworthy answer yet: still loading, or the last fetch failed (the focus/reconnect refetch recovers). Never the first-launch case.
    isPending: [current, activities].some(
      (query) => query.isPending || query.isError,
    ),
  }
}
