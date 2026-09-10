import { describe, expect, test } from 'vitest'

import theme from '../../../design-system/theme.json'

import {
  ACTIVITY_PALETTE,
  cycleColor,
  DEFAULT_ACTIVITIES,
} from './activity-palette'
import {
  activityColorSchema,
  activityInputSchema,
  firstIssuePerField,
  signUpSchema,
} from './schemas'

describe('design-system/theme.json stays the single source of truth', () => {
  test('activity palette is the 8 design colours in cycle order', () => {
    // Arrange
    const expected = [
      '#E0A431',
      '#3B7BD9',
      '#4FA877',
      '#6C63D6',
      '#E0684A',
      '#D8579C',
      '#2BA3B5',
      '#8A6A4B',
    ]

    // Assert
    expect([...ACTIVITY_PALETTE]).toEqual(expected)
    expect(theme.activityPalette).toEqual(expected)
  })

  test('sign-up seeds the six designed default activities in grid order', () => {
    // Arrange
    const expected = [
      {
        id: 'house',
        name: '家事',
        color: '#E0A431',
        iconKey: 'home',
        target: 1.5,
      },
      {
        id: 'work',
        name: '仕事',
        color: '#3B7BD9',
        iconKey: 'work',
        target: 8,
      },
      {
        id: 'rest',
        name: '休息',
        color: '#4FA877',
        iconKey: 'rest',
        target: 2,
      },
      {
        id: 'sleep',
        name: '睡眠',
        color: '#6C63D6',
        iconKey: 'sleep',
        target: 7,
      },
      {
        id: 'meal',
        name: '食事',
        color: '#E0684A',
        iconKey: 'meal',
        target: 1.5,
      },
      {
        id: 'fun',
        name: '娯楽',
        color: '#D8579C',
        iconKey: 'fun',
        target: 1.5,
      },
    ]

    // Assert
    expect([...DEFAULT_ACTIVITIES]).toEqual(expected)
    expect(theme.defaultActivities).toEqual(expected)
  })

  test('cycling a colour walks the palette in design order and wraps', () => {
    // Arrange: the palette's first entry, one mid-list, the last one (which has to wrap) and a colour the palette never had.
    const colors = ['#E0A431', '#D8579C', '#8A6A4B', '#000000']

    // Act
    const walk = colors.map(cycleColor)

    // Assert
    expect(walk).toEqual(['#3B7BD9', '#2BA3B5', '#E0A431', '#E0A431'])
  })

  test('every default activity uses a colour from the palette', () => {
    // Act
    const results = DEFAULT_ACTIVITIES.map(
      (activity) => activityColorSchema.safeParse(activity.color).success,
    )

    // Assert
    expect(results).toEqual([true, true, true, true, true, true])
  })
})

describe('activity editor validation', () => {
  test('rejects a colour outside the design palette', () => {
    // Arrange
    const input = {
      name: '読書',
      color: '#FF0000',
      iconKey: 'book',
      targetHours: 1,
    }

    // Act
    const result = activityInputSchema.safeParse(input)

    // Assert
    expect(result.success).toBe(false)
  })

  test('trims the name and accepts "no target" as null', () => {
    // Arrange
    const input = {
      name: '  読書  ',
      color: '#2BA3B5',
      iconKey: 'book',
      targetHours: null,
    }

    // Act
    const result = activityInputSchema.parse(input)

    // Assert
    expect(result).toEqual({
      name: '読書',
      color: '#2BA3B5',
      iconKey: 'book',
      targetHours: null,
    })
  })
})

test('sign-up validation reports the first message per field', () => {
  // Arrange
  const result = signUpSchema.safeParse({ name: '', email: 'x', password: '1' })

  // Act
  const messages = result.success ? {} : firstIssuePerField(result.error)

  // Assert
  expect(messages).toEqual({
    name: '名前を入力してください',
    email: 'メールアドレスの形式が正しくありません',
    password: 'パスワードは8文字以上にしてください',
  })
})
