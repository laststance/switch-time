import { useQuery } from '@tanstack/react-query'

import { orpc } from '@/lib/orpc'

import { useAllActivities } from './use-activities'

/**
 * The current state (latest switch) joined with its activity; `current` is null before the very first tap, which is the first-launch case.
 * Archived activities are included in the join: another device can archive the state Home is showing, and that is not first launch.
 * `activity` is null both while the list is loading and while the state is detox (`activityId` null); `activitiesLoaded` tells them apart.
 * @example const { current, activity, activitiesLoaded, isPending, isError, retry } = useCurrentActivity()
 */
export function useCurrentActivity() {
  const current = useQuery(orpc.switches.current.queryOptions())
  const activities = useAllActivities()
  const queries = [current, activities]
  const activity =
    activities.data?.find((row) => row.id === current.data?.activityId) ?? null
  return {
    current: current.data ?? null,
    activity,
    // Stays true through a failed refetch (TanStack keeps `data`), so detox does not drop to the error frame over a blip.
    activitiesLoaded: activities.data !== undefined,
    isPending: queries.some((query) => query.isPending),
    // Surfaced rather than folded into isPending: a failed fetch must offer a retry instead of an empty frame forever.
    isError: queries.some((query) => query.isError),
    retry: () => queries.forEach((query) => void query.refetch()),
  }
}
