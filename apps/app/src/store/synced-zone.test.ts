import { expect, test } from 'vitest'

import { selectSyncedZone, syncedZoneSlice, zoneSynced } from './synced-zone'

test('a zone synced for one account is read back for that account only, so a second account still gets its zone written', () => {
  // Arrange
  const state = syncedZoneSlice.reducer(
    undefined,
    zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }),
  )

  // Act
  const firstAccountZone = selectSyncedZone({ syncedZone: state }, 'account-1')
  const secondAccountZone = selectSyncedZone({ syncedZone: state }, 'account-2')

  // Assert
  expect(firstAccountZone).toBe('Asia/Tokyo')
  expect(secondAccountZone).toBeNull()
})

test('a device that moved and synced again remembers its new zone for the account', () => {
  // Arrange
  const tokyo = syncedZoneSlice.reducer(
    undefined,
    zoneSynced({ accountId: 'account-1', zone: 'Asia/Tokyo' }),
  )

  // Act
  const london = syncedZoneSlice.reducer(
    tokyo,
    zoneSynced({ accountId: 'account-1', zone: 'Europe/London' }),
  )

  // Assert
  expect(selectSyncedZone({ syncedZone: london }, 'account-1')).toBe(
    'Europe/London',
  )
})

test('while signed out no zone is read or kept, so the next account to sign in starts unsynced', () => {
  // Act
  const state = syncedZoneSlice.reducer(
    undefined,
    zoneSynced({ accountId: undefined, zone: 'Asia/Tokyo' }),
  )

  // Assert
  expect(state.byAccount).toEqual({})
  expect(selectSyncedZone({ syncedZone: state }, undefined)).toBeNull()
})
