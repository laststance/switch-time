import { useMutation } from '@tanstack/react-query'
import { useRouter } from 'expo-router'

import { authClient } from '@/lib/auth-client'
import { queryClient } from '@/lib/query'
import { resetApp, useAppDispatch } from '@/store'

/**
 * Ends the session everywhere the user left traces: Better Auth first, then the TanStack cache and Redux, then shows sign-in.
 * Local state survives a failed sign-out so the UI never claims a session ended while the server still holds it.
 * @example const signOut = useSignOut(); <Button title="サインアウト" onPress={() => signOut.mutate()} disabled={signOut.isPending} />
 */
export function useSignOut() {
  const router = useRouter()
  const dispatch = useAppDispatch()
  return useMutation({
    mutationFn: async () => {
      const { error } = await authClient.signOut()
      if (error)
        throw new Error(error.message ?? 'サインアウトできませんでした')
    },
    onSuccess: () => {
      queryClient.clear()
      dispatch(resetApp())
      router.replace('/sign-in')
    },
  })
}
