import { Sheet } from '@/components/sheet'

// Content lands with MVP-14.
export default function CorrectionSheet() {
  return (
    <Sheet
      title="今日の記録を訂正"
      hint="行をタップ → 開始時刻を15分ずつ動かす／活動を変える"
    />
  )
}
