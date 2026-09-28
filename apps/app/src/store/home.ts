import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import { correctionSlice } from './correction'

const initialState: { tapRefusal: string | null } = { tapRefusal: null }

/**
 * ホーム's refusal line: why the last tap or digit key was refused ({@link tapFailureMessage}), shown under the detox row on
 * ホーム and on the first-launch screen alike. Kept in the store, not in either screen, because a refused first tap swaps ホーム
 * back to the first-launch screen, which must still say why. {@link useSwitchTo} sets and clears it; the next tap clears it,
 * and so do a sign-out (`resetApp`) and another account signing in in another tab ({@link useAccountScope}).
 * @example dispatch(homeSlice.actions.tapRefused('処理が混み合っています。少し待ってからもう一度お試しください'))
 */
export const homeSlice = createSlice({
  name: 'home',
  initialState,
  reducers: {
    tapPressed(state) {
      state.tapRefusal = null
    },
    tapRefused(state, action: PayloadAction<string>) {
      state.tapRefusal = action.payload
    },
  },
  extraReducers: (builder) => {
    // Another account's screen: a line about the previous account's tap would no longer be true here.
    builder.addCase(correctionSlice.actions.accountSeen, (state) => {
      state.tapRefusal = null
    })
  },
})
