/**
 * The one state with no activity, as every surface names and draws it: the hero ({@link nowLook}), the {@link DetoxRow}, the
 * correction sheet's row and pill, the 24-h bar's legend. No colour means outlined solid in `sub` rather than filled: the
 * 24-h bar, the correction sheet's bar and chip, History's detox day cell and a day's detox slice, the 状態別 detox row's chip.
 * Dashed is kept for no data (idle spans, excluded days).
 * @example <ActivityPill name={DETOX.name} color={DETOX.color} iconKey={DETOX.iconKey} … />
 */
export const DETOX: { name: string; color: null; iconKey: string } = {
  name: 'detox',
  color: null,
  iconKey: 'wind',
}
