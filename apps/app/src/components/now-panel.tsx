import { Text, View } from 'react-native'

import { Dial } from '@/components/dial'
import { Readout } from '@/components/readout'
import { useWide } from '@/hooks/use-wide'
import { formatElapsed } from '@/lib/format'
import type { NowLook } from '@/lib/home'
import { cn } from '@/lib/utils'
import { useAppSelector } from '@/store'

// Wide web sits the 176 px dial beside the status block inside a surface card; phones stack the 236 px dial over a centred block,
// whose lines wrap centred too.
const BANDS = {
  wide: {
    root: 'flex-row flex-wrap items-center gap-6 rounded-card border border-line bg-surface p-6',
    dial: 176,
    status: 'min-w-[220px] flex-1 items-start gap-1',
    name: 'text-xl',
    line: '',
  },
  narrow: {
    root: 'items-center gap-4',
    dial: 236,
    status: 'items-center gap-0.5',
    name: 'text-lg',
    line: 'text-center',
  },
}

// Detox has no colour of its own (pen 310ed5c): a hollow `sub` dot, the name in ink, the readout dimmed; the dial falls back to `sub`.
const paint = (color: string | null) =>
  color === null
    ? {
        dot: 'border-2 border-sub',
        name: 'text-ink',
        readout: 'text-sub',
        fill: undefined,
        ink: undefined,
      }
    : {
        dot: '',
        name: '',
        readout: '',
        fill: { backgroundColor: color },
        ink: { color },
      }

type NowPanelProps = {
  /** The current state's texts and colour ({@link nowLook}). */
  look: NowLook
  startedAt: number
}

/**
 * The hero of Home: the dial, the current state in its own colour (detox in none), the elapsed time ticking from the clock slice,
 * and the detox notice: on its run's last measured day that tomorrow will not count, and on a day it no longer measures that
 * today does not.
 * @example <NowPanel look={nowLook(activity, since, switchCount, notice)} startedAt={current.startedAt.getTime()} />
 */
export function NowPanel({ look, startedAt }: NowPanelProps) {
  const band = BANDS[useWide() ? 'wide' : 'narrow']
  const tone = paint(look.color)
  const now = useAppSelector((s) => s.clock.now)
  const elapsed = formatElapsed(now - startedAt)
  return (
    <View className={band.root}>
      <Dial size={band.dial} color={look.color} />
      <View className={band.status}>
        <View className="flex-row items-center gap-2">
          <View
            className={cn('h-2.5 w-2.5 rounded-pill', tone.dot)}
            style={tone.fill}
          />
          <Text
            className={cn('font-bold tracking-tight', band.name, tone.name)}
            style={tone.ink}
          >
            {look.name}
          </Text>
        </View>
        {/* aria-label replaces the visible digits for AT, so the ticking value stays in the name. */}
        <Readout className={tone.readout} aria-label={`経過時間 ${elapsed}`}>
          {elapsed}
        </Readout>
        <Text className={cn('text-sub text-xs', band.line)}>
          {look.subtext}
        </Text>
        {/* A detox past its week (pen `ST Phone / ホーム・detox の状態`): the one ink line after the name, then the rule. */}
        {look.notice && (
          <View className="gap-0.5 pt-1.5">
            <Text className={cn('text-ink text-sm font-semibold', band.line)}>
              {look.notice.title}
            </Text>
            <Text className={cn('text-sub text-xs', band.line)}>
              {look.notice.body}
            </Text>
          </View>
        )}
      </View>
    </View>
  )
}
