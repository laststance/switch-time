/**
 * The one state with no activity, as every surface names and draws it: the hero ({@link nowLook}), the {@link DetoxRow}, the
 * correction sheet's row and pill, the 24-h bar's legend. No colour means outlined (dashed) rather than filled.
 * @example <ActivityPill name={DETOX.name} color={DETOX.color} iconKey={DETOX.iconKey} … />
 */
export const DETOX: { name: string; color: null; iconKey: string } = {
  name: 'detox',
  color: null,
  iconKey: 'wind',
}
