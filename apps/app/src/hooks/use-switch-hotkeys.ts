import { usePathname } from 'expo-router'

import { useWebKeydown } from '@/hooks/use-web-keydown'
import { hotkeyPick } from '@/lib/hotkeys'

/**
 * The web digit hotkeys of the switch buttons (`1`–`6` by position, `0` detox, like the menubar's ⌘1–6 and ⌘0), for Home and the
 * first-launch screen, which show the same buttons in the same order. `pick` decides what a press sends: Home drops a re-tap of
 * the running state, the first-launch screen sends every pick.
 * @param activities - The switch buttons' activities, in the order they are shown.
 * @param pick - Called with the picked activity id, or `null` for detox.
 * @example useSwitchHotkeys(activities, (activityId) => switchTo.mutate({ activityId }))
 */
export function useSwitchHotkeys(
  activities: readonly { id: string }[],
  pick: (activityId: string | null) => void,
): void {
  const pathname = usePathname()
  useWebKeydown((event) => {
    // A sheet above Home (or another tab, Home stays mounted) owns the keyboard.
    if (pathname !== '/') return
    const picked = hotkeyPick(event, activities)
    if (picked !== undefined) pick(picked)
  })
}
