import { useEffect } from 'react'
import { AccessibilityInfo, Platform } from 'react-native'

/**
 * Says a status line's `text` through VoiceOver each time it changes. React Native has no live region on iOS, so `aria-live`
 * and `role="alert"` are read on the web and Android only; there this does nothing, or the line would be read twice. Used by
 * the タイムゾーン sheet's line under the search and the correction sheet's status line.
 * @param text - The line's current text, or undefined while there is none.
 * @example useIosAnnouncement(status?.text) // 'ニューヨークに変更しました' is spoken on iOS
 */
export function useIosAnnouncement(text: string | undefined): void {
  useEffect(() => {
    if (text && Platform.OS === 'ios')
      AccessibilityInfo.announceForAccessibility(text)
  }, [text])
}
