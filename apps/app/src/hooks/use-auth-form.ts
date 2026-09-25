import { firstIssuePerField } from '@switch-time/shared'
import { useMutation } from '@tanstack/react-query'
import type { Href } from 'expo-router'
import { useState } from 'react'
import type { ZodType } from 'zod'

type AuthResult = { error: { message?: string } | null }

/**
 * Shared mechanics of the auth forms: Zod-validate on submit, first issue per field, the request as a mutation (the button waits on
 * `isPending`, Better Auth's message is its error). Success runs `onDone` from the mutation's own options, so it also runs when the
 * form has gone by the time the answer lands: sign-in's session lands anyway, and its reset must not be skipped. Sign-up passes
 * `register`, which moves on only while sign-up is still in front.
 * @param onDone - Runs after a successful submit with the submitted values, even if the form has unmounted since.
 * @example const form = useAuthForm(signInSchema, { email: '', password: '' }, (v) => authClient.signIn.email(v), resetForNewSession)
 * @example useAuthForm(signUpSchema, blank, (v) => authClient.signUp.email(v), (v) => register(v.email))
 */
export function useAuthForm<T extends Record<string, string>>(
  schema: ZodType<T>,
  initial: T,
  submit: (values: T) => Promise<AuthResult>,
  onDone?: (values: T) => void,
) {
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
    onSuccess: (_result, sent) => onDone?.(sent),
  })

  const set =
    (key: keyof T) =>
    (text: string): void =>
      setValues((current) => ({ ...current, [key]: text }))

  const onSubmit = (): void => {
    const parsed = schema.safeParse(values)
    if (!parsed.success) return setFieldErrors(firstIssuePerField(parsed.error))
    setFieldErrors({})
    request.mutate(parsed.data)
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
