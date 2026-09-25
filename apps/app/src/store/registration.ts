import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit'

/** The account just registered on this device: the address sign-in starts with, and whether its 登録しました notice still shows. */
export type Registration = {
  email: string
  // New for every registration (a counter would restart after sign-in's or sign-out's reset and could repeat the key sign-in kept). Sign-in keys its form on it,
  // so a new registration refills the form and dismissing the notice does not.
  id: string
  notice: boolean
}

const initialState: { current: Registration | null } = { current: null }

/**
 * Carries a registration from sign-up to sign-in without putting the address in the URL (history, logs); sign-in's success
 * and sign-out reset it with the rest of the store.
 * @example dispatch(registrationSlice.actions.registered('a@example.com'))
 */
export const registrationSlice = createSlice({
  name: 'registration',
  initialState,
  reducers: {
    registered: {
      reducer(state, action: PayloadAction<Omit<Registration, 'notice'>>) {
        state.current = { ...action.payload, notice: true }
      },
      prepare: (email: string) => ({ payload: { email, id: nanoid() } }),
    },
    noticeDismissed(state) {
      if (state.current) state.current.notice = false
    },
  },
})
