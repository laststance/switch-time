import { describe, expect, test, vi } from 'vitest'

import { nextHref } from './use-auth-form'

// The real client pulls in react-native, which Node cannot load; nextHref never touches it.
vi.mock('@/lib/query', () => ({ queryClient: { clear: () => {} } }))

describe('nextHref', () => {
  test('returns to the same-app URL that was opened, query included', () => {
    // Arrange
    const next = '/correction?day=2026-09-08'

    // Act
    const href = nextHref(next)

    // Assert
    expect(href).toBe('/correction?day=2026-09-08')
  })

  test('sends off-site and protocol-relative targets home instead of redirecting away', () => {
    // Arrange
    const targets = [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'evil.example',
      '',
    ]

    // Act
    const hrefs = targets.map((target) => nextHref(target))

    // Assert
    expect(hrefs).toEqual(['/', '/', '/', '/', '/'])
    expect(nextHref()).toBe('/')
  })

  test('a repeated ?next= (parsed as an array) goes home instead of crashing the redirect', () => {
    // Arrange
    const next = ['/history', '/settings']

    // Act
    const href = nextHref(next)

    // Assert
    expect(href).toBe('/')
  })
})
