import '@/global.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { Stack } from 'expo-router'
import { Provider as ReduxProvider } from 'react-redux'

import { useClock } from '@/hooks/use-clock'
import { useThemeSync } from '@/hooks/use-theme-sync'
import { queryClient } from '@/lib/query'
import { store } from '@/store'

// Store-backed hooks must run below the provider, hence the extra component.
function AppShell() {
  useClock()
  useThemeSync()
  return <Stack screenOptions={{ headerShown: false }} />
}

export default function RootLayout() {
  return (
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    </ReduxProvider>
  )
}
