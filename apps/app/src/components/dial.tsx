import Svg, { Circle, G, Line, Path } from 'react-native-svg'

import { useTokenColors } from '@/hooks/use-token-color'
import { handAngles } from '@/lib/dial'
import { useAppSelector } from '@/store'

// Three tiers of tick (design-system readme § The dial): quarters longest in ink, hours in sub, minutes a hairline in line.
const TIERS = {
  quarter: { y2: 30, width: 3, token: 'ink' },
  hour: { y2: 26, width: 2, token: 'sub' },
  minute: { y2: 20, width: 1, token: 'line' },
} as const

const TICKS = Array.from({ length: 60 }, (_, index) => ({
  deg: index * 6,
  tier: index % 15 === 0 ? 'quarter' : index % 5 === 0 ? 'hour' : 'minute',
})) satisfies { deg: number; tier: keyof typeof TIERS }[]

type DialProps = {
  size: number
  /** The current activity's colour: the bezel ring, the second hand and the centre pin. */
  color: string
}

/**
 * The clock from the design as one `react-native-svg` drawing on the 200-box: `face` steps off its ground with a `line` rim, a 1.5 px activity bezel, three tick tiers,
 * dauphine hour/minute hands, the second hand with tail and counterweight (per the `showSecondHand` preference) and the 3-layer cap. No filter, no shadow.
 * @example <Dial size={236} color={activity.color} />
 */
export function Dial({ size, color }: DialProps) {
  const tone = useTokenColors(['ink', 'sub', 'line', 'face'])
  const now = useAppSelector((s) => s.clock.now)
  const showSecondHand = useAppSelector((s) => s.preferences.showSecondHand)
  const angles = handAngles(new Date(now))
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Circle
        cx={100}
        cy={100}
        r={99}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
      />
      <Circle
        cx={100}
        cy={100}
        r={90}
        fill={tone.face}
        stroke={tone.line}
        strokeWidth={1}
      />
      {TICKS.map((tick) => (
        <Line
          key={tick.deg}
          x1={100}
          y1={16}
          x2={100}
          y2={TIERS[tick.tier].y2}
          stroke={tone[TIERS[tick.tier].token]}
          strokeWidth={TIERS[tick.tier].width}
          strokeLinecap="round"
          transform={`rotate(${tick.deg} 100 100)`}
        />
      ))}
      <Path
        d="M100 51 L103.2 72 L101.6 104 L98.4 104 L96.8 72 Z"
        fill={tone.ink}
        stroke={tone.ink}
        strokeWidth={1.2}
        strokeLinejoin="round"
        transform={`rotate(${angles.hour} 100 100)`}
      />
      <Path
        d="M100 29 L102.4 56 L101.3 104 L98.7 104 L97.6 56 Z"
        fill={tone.ink}
        stroke={tone.ink}
        strokeWidth={1}
        strokeLinejoin="round"
        transform={`rotate(${angles.minute} 100 100)`}
      />
      {showSecondHand && (
        <G transform={`rotate(${angles.second} 100 100)`}>
          <Line
            x1={100}
            y1={120}
            x2={100}
            y2={24}
            stroke={color}
            strokeWidth={1.2}
            strokeLinecap="round"
          />
          <Circle cx={100} cy={116} r={3.4} fill={color} />
        </G>
      )}
      <Circle
        cx={100}
        cy={100}
        r={5.6}
        fill={tone.face}
        stroke={tone.ink}
        strokeWidth={1.4}
      />
      <Circle cx={100} cy={100} r={2.6} fill={color} />
      <Circle cx={100} cy={100} r={0.9} fill={tone.face} />
    </Svg>
  )
}
