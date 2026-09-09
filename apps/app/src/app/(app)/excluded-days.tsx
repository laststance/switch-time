import { Sheet } from '@/components/sheet'

// Content lands with MVP-17.
export default function ExcludedDaysSheet() {
  return (
    <Sheet
      title="未使用日の扱い"
      hint="一度も切り替えなかった日は「計測なし」として平均・連続記録から外します。"
    />
  )
}
