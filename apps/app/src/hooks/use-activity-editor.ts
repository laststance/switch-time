import {
  activityInputSchema,
  cycleColor,
  type ActivityInput,
} from '@switch-time/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useCurrentActivity } from '@/hooks/use-current-activity'
import { cycleIcon } from '@/lib/icons'
import { orpc } from '@/lib/orpc'
import { invalidateKeys } from '@/lib/query'
import {
  editorRows,
  reorderIds,
  spareColor,
  targetHoursFromText,
  type EditorRow,
} from '@/lib/settings'

// What 「＋ 項目を追加」 creates; the user renames it in place. The colour is the first palette entry not in use.
const NEW_ACTIVITY = { name: '新しい項目', iconKey: 'home', targetHours: null }

/**
 * Everything the 活動項目 sheet does with `activities.*`: the row model ({@link editorRows}), rename / colour / icon / target through
 * `update` (which takes the whole input, so each edit resends the row's other fields), ▲▼ through `reorder`, 「＋ 項目を追加」 and 🗑.
 * Every write invalidates `activities.*`, so Home, History and the rail badge follow at once.
 * @example const editor = useActivityEditor(); editor.recolor(row)
 */
export function useActivityEditor() {
  const queryClient = useQueryClient()
  const activities = useQuery(orpc.activities.list.queryOptions())
  const {
    current,
    isPending: currentPending,
    isError: currentError,
    retry: retryCurrent,
  } = useCurrentActivity()
  const write = {
    onSettled: async () => invalidateKeys(queryClient, [orpc.activities.key()]),
  }
  const update = useMutation({
    // `update` resends the whole row, so two edits in flight at once would leave the server on whichever landed last, not last-typed.
    // ponytail: one scope for every row (the editor edits one at a time); per-row scopes would need a mutation instance per row.
    scope: { id: 'activities.update' },
    ...orpc.activities.update.mutationOptions(),
    ...write,
    // Written into the list first, so an edit committed while this one is in flight builds on it, not on the stale row.
    onMutate: async ({ id, ...values }) => {
      const queryKey = orpc.activities.list.queryKey()
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData(queryKey)
      queryClient.setQueryData(queryKey, (rows) =>
        rows?.map((row) => (row.id === id ? { ...row, ...values } : row)),
      )
      return { previous }
    },
    // Put the row back at once rather than leaving the refused edit on screen until the refetch below answers.
    onError: (_error, _input, context) => {
      if (context)
        queryClient.setQueryData(
          orpc.activities.list.queryKey(),
          context.previous,
        )
    },
  })
  const create = useMutation({
    ...orpc.activities.create.mutationOptions(),
    ...write,
  })
  const reorder = useMutation({
    ...orpc.activities.reorder.mutationOptions(),
    ...write,
  })
  const archive = useMutation({
    ...orpc.activities.archive.mutationOptions(),
    ...write,
  })
  const rows = editorRows(activities.data, current?.activityId ?? null)
  // A value the schema refuses (a 25-hour target, a blank name) is dropped rather than sent; false tells the field to put itself back.
  const patch = (row: EditorRow, change: Partial<ActivityInput>) => {
    // The cached row rather than the rendered one: it already carries an edit that has not settled yet.
    const latest =
      queryClient
        .getQueryData(orpc.activities.list.queryKey())
        ?.find((each) => each.id === row.id) ?? row
    const input = activityInputSchema.safeParse({ ...latest, ...change })
    if (!input.success) return false
    update.mutate({ id: row.id, ...input.data })
    return true
  }
  return {
    rows,
    // Also while switches.current is unknown: until then no row can be told apart from the current activity (the one 🗑 refuses).
    pending: [
      activities.isFetching,
      currentPending,
      ...[update, create, reorder, archive].map(
        (mutation) => mutation.isPending,
      ),
    ].some(Boolean),
    // Either query failing leaves the sheet with an empty list and no reason; it swaps in a 再読み込み notice instead.
    isError: [activities.isError, currentError].some(Boolean),
    retry: () => {
      void activities.refetch()
      retryCurrent()
    },
    rename: (row: EditorRow, name: string) =>
      name === row.name ? true : patch(row, { name }),
    retarget: (row: EditorRow, text: string) => {
      const targetHours = targetHoursFromText(text)
      return targetHours === row.targetHours
        ? true
        : patch(row, { targetHours })
    },
    recolor: (row: EditorRow) => patch(row, { color: cycleColor(row.color) }),
    reicon: (row: EditorRow) => patch(row, { iconKey: cycleIcon(row.iconKey) }),
    move: (row: EditorRow, delta: 1 | -1) =>
      reorder.mutate({
        ids: reorderIds(
          rows.map((each) => each.id),
          row.id,
          delta,
        ),
      }),
    remove: (row: EditorRow) => archive.mutate({ id: row.id }),
    add: () =>
      create.mutate({
        ...NEW_ACTIVITY,
        color: spareColor(rows.map((each) => each.color)),
      }),
  }
}
