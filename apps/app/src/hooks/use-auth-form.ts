import { firstIssuePerField } from '@switch-time/shared'
import type { Href } from 'expo-router'
import { useState } from 'react'
import type { ZodType } from 'zod'

type AuthResult = { error: { message?: string } | null }

/**
 * Shared mechanics of the auth forms: Zod-validate on submit, first issue per field, server message, button gated while the request runs.
 * @example const form = useAuthForm(signInSchema, { email: '', password: '' }, (v) => authClient.signIn.email(v), () => router.replace('/'))
 */
export function useAuthForm<T extends Record<string, string>>(
  schema: ZodType<T>,
  initial: T,
  submit: (values: T) => Promise<AuthResult>,
  onSuccess: () => void,
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
      else onSuccess()
    } finally {
      setPending(false)
    }
  }

  return { values, set, fieldErrors, serverError, pending, onSubmit }
}

/** The string members of {@link Href}: route literals once typed routes are generated, plain `string` on a checkout without `.expo/types` (CI). */
type AppPath = Extract<Href, string>

// A predicate rather than `as Href`: with typed routes the cast is needed, without them lint flags it as unnecessary.
const isAppPath = (value: string): value is AppPath => value.startsWith('/')

/**
 * Where to go after auth: the `next` query param when it is a same-app path, else Home (no open redirects).
 * @example router.replace(nextHref(params.next))
 */
export const nextHref = (next = ''): Href => (isAppPath(next) ? next : '/')
