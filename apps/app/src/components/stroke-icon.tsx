import Svg, { Path } from 'react-native-svg'

type StrokeIconProps = {
  d: string
  size: number
  strokeWidth: number
  color: string | undefined
}

/**
 * One design glyph (a 24-box stroke path from ST Web) at any size and colour; nav items, the rail badge and later the activity icons.
 * @example <StrokeIcon d="M12 7v5l3.5 2" size={18} strokeWidth={2.4} color={ink} />
 */
export function StrokeIcon({ d, size, strokeWidth, color }: StrokeIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      color={color}
    >
      <Path
        d={d}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  )
}
