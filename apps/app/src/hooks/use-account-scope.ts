import { useEffect } from 'react'

import { startTapSession } from '@/lib/optimistic-switch'
import { queryClient } from '@/lib/query'
import { useAppDispatch, useAppSelector } from '@/store'
import { accountChange, correctionSlice } from '@/store/correction'

/**
 * Keeps this tab's client state to the account its session reports. The session refetches on focus, so a sign-in as someone
 * else in another tab shows up here without this tab's sign-in or sign-out running: nothing of the previous account may stay
 * on screen (the query cache) or in an undo (the store). Mounted by {@link AppLayout}, which already reads the session.
 * @param account - The session's user id, undefined while there is no session.
 * @example useAccountScope(session?.user.id)
 */
export function useAccountScope(account: string | undefined): void {
  const dispatch = useAppDispatch()
  const seen = useAppSelector((s) => s.correction.account)
  useEffect(() => {
    const change = accountChange(seen, account)
    if (!change) return
    // `resetQueries` leaves the previous account's taps in the mutation cache: a new session of taps drops the queued ones before
    // they go out with this account's cookie, and keeps the running one from becoming this account's fallback or refetching over
    // its picks.
    if (change.switched) {
      void queryClient.resetQueries()
      startTapSession(queryClient)
    }
    dispatch(correctionSlice.actions.accountSeen(change.account))
  }, [account, seen, dispatch])
}
