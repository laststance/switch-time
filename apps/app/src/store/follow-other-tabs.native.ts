/**
 * Native runs one copy of the app, so no other tab writes the store's device slices: nothing to follow. The web build loads
 * `follow-other-tabs.ts` instead. Called once by {@link createAppStore}.
 * @example followOtherTabs()
 */
export function followOtherTabs(): void {}
