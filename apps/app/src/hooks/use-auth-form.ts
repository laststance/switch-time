import { firstIssuePerField } from '@switch-time/shared'
import { useMutation } from '@tanstack/react-query'
import type { Href } from 'expo-router'
import { useState } from 'react'
import type { ZodType } from 'zod'

import { queryClient } from '@/lib/query'
import { resetApp, useAppDispatch } from '@/store'

type AuthResult = { error: { message?: string } | null }

// The latest auth submit on this device, across the sign-in and sign-up screens: an older one that answers late (a sign-up left
// pending on a slow link while the user went on) must not reset the store or navigate over the attempt made since. A token object,
// not a counter: the web build folded `const attempt = counter` into the counter itself and the check never failed.
let latestSubmit: object | null = null

/**
 * Shared mechanics of the auth forms: Zod-validate on submit, first issue per field, the request as a mutation (the button waits on
 * `isPending`, Better Auth's message is its error). Success clears the cache and the store, then runs `onDone`. Sign-in passes none:
 * the (auth) layout redirects once the session has landed, so the (app) guard never sees the gap in between. Sign-up gets no session
 * (`autoSignIn: false`) and passes `onDone` to move on to sign-in.
 * @param onDone - Runs after a successful submit with the submitted values, while the form is still mounted.
 * @example const form = useAuthForm(signInSchema, { email: '', password: '' }, (v) => authClient.signIn.email(v))
 * @example useAuthForm(signUpSchema, blank, (v) => authClient.signUp.email(v), (v) => register(v.email))
 */
export function useAuthForm<T extends Record<string, string>>(
  schema: ZodType<T>,
  initial: T,
  submit: (values: T) => Promise<AuthResult>,
  onDone?: (values: T) => void,
) {
  const dispatch = useAppDispatch()
  const [values, setValues] = useState(initial)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const request = useMutation({
    mutationFn: async (input: T) => {
      // A transport failure (offline, server down) reads like a server error instead of an unhandled rejection.
      const { error } = await submit(input).catch((): AuthResult => ({
        error: {},
      }))
      if (error) throw new Error(error.message ?? 'もう一度お試しください')
    },
  })

  const set =
    (key: keyof T) =>
    (text: string): void =>
      setValues((current) => ({ ...current, [key]: text }))

  const onSubmit = (): void => {
    const parsed = schema.safeParse(values)
    if (!parsed.success) return setFieldErrors(firstIssuePerField(parsed.error))
    setFieldErrors({})
    const attempt = {}
    latestSubmit = attempt
    // A new session must not inherit the previous account's cache (shared device; gcTime keeps it for minutes), nor its undo slots:
    // a session that expired or was revoked elsewhere reaches sign-in without sign-out's reset. The reset also draws a new epoch,
    // so an edit of the old session that lands late is ignored. Passed to `mutate` rather than the options: TanStack drops these
    // once the form has unmounted, so a sign-up the user walked away from cannot wipe a newer one or navigate when it answers.
    request.mutate(parsed.data, {
      onSuccess: (_result, sent) => {
        // Superseded by a newer submit: its answer no longer speaks for what the user is doing.
        if (attempt !== latestSubmit) return
        queryClient.clear()
        dispatch(resetApp())
        onDone?.(sent)
      },
    })
  }

  return {
    values,
    set,
    fieldErrors,
    serverError: request.error?.message ?? null,
    pending: request.isPending,
    // The request went through; sign-in keeps its button off from here until the session lands ({@link signInBusy}).
    succeeded: request.isSuccess,
    onSubmit,
  }
}

/** The string members of {@link Href}: route literals once typed routes are generated, plain `string` on a checkout without `.expo/types` (CI). */
type AppPath = Extract<Href, string>

// A predicate rather than `as Href`: with typed routes the cast is needed, without them lint flags it as unnecessary.
// One leading slash only: `//host` is a protocol-relative URL (expo-router treats it as external) and browsers read `/\host` the same way.
const isAppPath = (value: string): value is AppPath =>
  /^\/(?![/\\])/.test(value)

/**
 * Where to go after auth: the `next` query param when it is a same-app path, else Home (no open redirects; a repeated `?next=` arrives as an array and goes Home too).
 * @example router.replace(nextHref(params.next))
 */
export const nextHref = (next?: string | string[]): Href =>
  typeof next === 'string' && isAppPath(next) ? next : '/'
