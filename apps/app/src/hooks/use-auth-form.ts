import { firstIssuePerField } from '@switch-time/shared'
import type { Href } from 'expo-router'
import { useState } from 'react'
import type { ZodType } from 'zod'

import { queryClient } from '@/lib/query'

type AuthResult = { error: { message?: string } | null }

/**
 * Shared mechanics of the auth forms: Zod-validate on submit, first issue per field, server message, button gated while the request runs.
 * Success only clears the cache: the (auth) layout redirects once the session has landed, so the (app) guard never sees the gap in between.
 * @example const form = useAuthForm(signInSchema, { email: '', password: '' }, (v) => authClient.signIn.email(v))
 */
export function useAuthForm<T extends Record<string, string>>(
  schema: ZodType<T>,
  initial: T,
  submit: (values: T) => Promise<AuthResult>,
) {
  const [values, setValues] = useState(initial)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const set = (key: keyof T) => (text: string) =>
    setValues((current) => ({ ...current, [key]: text }))

  const onSubmit = async () => {
    const parsed = schema.safeParse(values)
    if (!parsed.success) return setFieldErrors(firstIssuePerField(parsed.error))
    setFieldErrors({})
    setServerError(null)
    setPending(true)
    try {
      const { error } = await submit(parsed.data)
      if (error) setServerError(error.message ?? 'もう一度お試しください')
      // A new session must not inherit the previous account's cache (shared device; gcTime keeps it for minutes).
      else queryClient.clear()
    } catch {
      // Transport failure (offline, server down): surfaced inline like a server error instead of an unhandled rejection.
      setServerError('もう一度お試しください')
    } finally {
      setPending(false)
    }
  }

  return { values, set, fieldErrors, serverError, pending, onSubmit }
}

/** The string members of {@link Href}: route literals once typed routes are generated, plain `string` on a checkout without `.expo/types` (CI). */
type AppPath = Extract<Href, string>

// A predicate rather than `as Href`: with typed routes the cast is needed, without them lint flags it as unnecessary.
// One leading slash only: `//host` is a protocol-relative URL (expo-router treats it as external) and browsers read `/\host` the same way.
const isAppPath = (value: string): value is AppPath =>
  /^\/(?![/\\])/.test(value)

/**
 * Where to go after auth: the `next` query param when it is a same-app path, else Home (no open redirects).
 * @example router.replace(nextHref(params.next))
 */
export const nextHref = (next = ''): Href => (isAppPath(next) ? next : '/')
