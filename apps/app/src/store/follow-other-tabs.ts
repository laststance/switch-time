/**
 * Reads the store's device slices back whenever another tab of the web app saves them. Each tab otherwise keeps the copy it
 * read at launch: it would judge a zone sync against a zone another tab has since replaced, and its next save would drop the
 * accounts only the other tab synced. Called once by {@link createAppStore}; the native build loads `follow-other-tabs.native.ts`.
 * @param key - The store's storage key; saves under any other key are not the store's.
 * @param rehydrate - The storage middleware's read-back.
 * @param tabs - Where the browser reports another tab's `localStorage` writes; absent outside a browser (tests, SSR).
 * @example followOtherTabs('switch-time.device', persistence.api.rehydrate)
 */
export function followOtherTabs(
  key: string,
  rehydrate: () => Promise<void>,
  tabs: EventTarget | undefined = globalThis.window,
): void {
  tabs?.addEventListener('storage', (event) => {
    if ('key' in event && event.key === key) void rehydrate()
  })
}
