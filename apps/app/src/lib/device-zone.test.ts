import { afterEach, expect, test, vi } from 'vitest'

import { deviceZone } from './device-zone'

afterEach(() => {
  vi.restoreAllMocks()
})

test('a device that moves to another zone while the app stays open reports its new zone, not the one it had at launch', () => {
  // Arrange: the device starts in Tokyo.
  const tokyo = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
  }).resolvedOptions()
  const london = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/London',
  }).resolvedOptions()
  const resolvedOptions = vi
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockReturnValue(tokyo)
  const zoneAtLaunch = deviceZone()

  // Act: the device lands in London.
  resolvedOptions.mockReturnValue(london)
  const zoneAfterMove = deviceZone()

  // Assert
  expect(zoneAtLaunch).toBe('Asia/Tokyo')
  expect(zoneAfterMove).toBe('Europe/London')
})
