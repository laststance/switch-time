import { useRouter } from 'expo-router'

import { authClient } from '@/lib/auth-client'
import { queryClient } from '@/lib/query'
import { resetApp, useAppDispatch } from '@/store'

/**
 * Ends the session everywhere the user left traces: Better Auth, the TanStack cache, Redux; then shows sign-in.
 * @example const signOut = useSignOut(); <Button title="サインアウト" onPress={() => void signOut()} />
 */
export function useSignOut() {
  const router = useRouter()
  const dispatch = useAppDispatch()
  return async () => {
    await authClient.signOut()
    queryClient.clear()
    dispatch(resetApp())
    router.replace('/sign-in')
  }
}
