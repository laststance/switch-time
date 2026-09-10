import { useState } from 'react'
import { ScrollView, Text, type TextInputProps, View } from 'react-native'

import { ActivityChip } from '@/components/activity-chip'
import { Control } from '@/components/control'
import { RetryNotice } from '@/components/retry-notice'
import { Sheet } from '@/components/sheet'
import { Input } from '@/components/ui/input'
import { useActivityEditor } from '@/hooks/use-activity-editor'
import type { EditorRow } from '@/lib/settings'

type DraftInputProps = Omit<
  TextInputProps,
  'value' | 'defaultValue' | 'onChangeText' | 'onBlur'
> & {
  value: string
  /** False means nothing was written — the schema refused the text, or it parsed to the value already stored — so the field shows that stored value again. */
  onCommit: (text: string) => boolean
}

// A field that keeps its own draft and hands it over when focus leaves (Enter blurs a single-line field on both platforms);
// the parent's `key` re-seeds it when the stored value changes.
function DraftInput({ value, onCommit, ...props }: DraftInputProps) {
  const [draft, setDraft] = useState(value)
  return (
    <Input
      {...props}
      value={draft}
      onChangeText={setDraft}
      onBlur={() => {
        if (!onCommit(draft)) setDraft(value)
      }}
    />
  )
}

type RowProps = { row: EditorRow; editor: ReturnType<typeof useActivityEditor> }

// One activity: ▲▼ reorder, the icon and the colour dot cycle on tap, the name and the target commit on blur, 🗑 archives.
function ActivityRow({ row, editor }: RowProps) {
  const pending = editor.pending
  return (
    <View className="flex-row items-center gap-2 rounded-card bg-chip py-2 pl-1 pr-2">
      <View>
        <Control
          label={`${row.name}を上へ`}
          disabled={pending || !row.canMoveUp}
          onPress={() => editor.move(row, -1)}
          className="h-5 w-7"
        >
          <Text className="text-2xs text-sub">▲</Text>
        </Control>
        <Control
          label={`${row.name}を下へ`}
          disabled={pending || !row.canMoveDown}
          onPress={() => editor.move(row, 1)}
          className="h-5 w-7"
        >
          <Text className="text-2xs text-sub">▼</Text>
        </Control>
      </View>
      <Control
        label={`${row.name}のアイコンを変える`}
        disabled={pending}
        onPress={() => editor.reicon(row)}
        className="h-11 w-11"
      >
        <ActivityChip
          color={row.color}
          iconKey={row.iconKey}
          size={44}
          iconSize={22}
        />
      </Control>
      <Control
        label={`${row.name}の色を変える`}
        disabled={pending}
        onPress={() => editor.recolor(row)}
        className="h-11 w-7"
      >
        <View
          className="h-[18px] w-[18px] rounded-pill"
          style={{ backgroundColor: row.color }}
        />
      </Control>
      <View className="flex-1 gap-1">
        <DraftInput
          key={row.name}
          aria-label={`${row.name}の名前`}
          value={row.name}
          maxLength={20}
          onCommit={(name) => editor.rename(row, name)}
          className="h-10 text-md font-semibold"
        />
        <View className="flex-row items-center gap-1.5">
          <Text className="text-2xs text-sub">1日の目安</Text>
          <DraftInput
            key={row.targetText}
            aria-label={`${row.name}の1日の目安`}
            value={row.targetText}
            inputMode="decimal"
            onCommit={(text) => editor.retarget(row, text)}
            className="h-8 w-14 text-center text-xs"
          />
          <Text className="text-2xs text-sub">時間</Text>
        </View>
      </View>
      <Control
        label={`${row.name}をアーカイブ`}
        disabled={pending || !row.canArchive}
        onPress={() => editor.remove(row)}
        className="h-11 w-9"
      >
        <Text className="text-md text-sub">🗑</Text>
      </Control>
    </View>
  )
}

/** The 活動項目 sheet from `ST Phone / 活動項目シート`: rows in `position` order in a scrolling list, 「＋ 項目を追加」 pinned below. */
export default function ActivityEditorSheet() {
  const editor = useActivityEditor()
  // Adding onto a list that never loaded would write a row the user cannot see, so the button waits with the list.
  const blocked = [editor.pending, editor.isError].some(Boolean)
  return (
    <Sheet
      title="活動項目"
      hint="タップで色・アイコンを変更、▲▼で並べ替え、🗑でアーカイブ"
    >
      {editor.isError ? (
        <RetryNotice onRetry={editor.retry} />
      ) : (
        <ScrollView className="shrink" contentContainerClassName="gap-2">
          {editor.rows.map((row) => (
            <ActivityRow key={row.id} row={row} editor={editor} />
          ))}
        </ScrollView>
      )}
      <Control
        disabled={blocked}
        onPress={editor.add}
        className="h-[52px] rounded-chip border border-line"
      >
        <Text className="text-sm font-semibold text-ink">＋ 項目を追加</Text>
      </Control>
    </Sheet>
  )
}
