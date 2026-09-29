import { authConfigSchema } from '@switch-time/shared'
import { expect, test } from 'vitest'

import { app } from './app'

// The tests run without SMTP_URL; the answer with a mail server is checked end to end (e2e/mail.spec.ts).
test('an API with no mail server says that nothing is confirmed by mail, so the app offers no password reset', async () => {
  // Act
  const response = await app.request('/api/auth-config')

  // Assert
  expect(response.status).toBe(200)
  expect(authConfigSchema.parse(await response.json())).toEqual({
    emailVerification: false,
  })
})
