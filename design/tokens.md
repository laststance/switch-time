# Switch Time — Design Tokens

`ST Phone.dc.html` / `Settings Modal.dc.html` の `renderVals()` から抽出（Claude Design のモバイル成果物が唯一の出典）。
Web / Mac menubar をデザインする際は**このファイルをそのまま制約として渡す**。

> `Switch Time.dc.html` の `.dv-*` CSS（`#1A1A1A` / `#2A78D6` など）はキャンバスの仕様シート自身のスタイル。
> アプリのトークンではないので混ぜないこと。

## 1. Theme tokens — light / dark ペア

面ごとに調整可。`theme: 'auto'` は 6:00–18:00 が light。

| token | light | dark | 用途 |
|---|---|---|---|
| `bg` | `#F5F2EB` | `#111216` | 画面背景 |
| `face` | `#FFFFFF` | `#1B1C22` | 時計盤面 |
| `surface` | `#FFFFFF` | `#1B1C22` | カード・非選択ボタン |
| `sheetBg` | `#FFFFFF` | `#1C1D22` | モーダル/シート |
| `ink` | `#1B1A17` | `#F2EFE8` | 本文 |
| `sub` | `rgba(27,26,23,0.55)` | `rgba(242,239,232,0.6)` | 補助テキスト |
| `line` | `rgba(27,26,23,0.12)` | `rgba(255,255,255,0.14)` | 罫線・枠 |
| `chip` | `rgba(27,26,23,0.06)` | `rgba(255,255,255,0.08)` | チップ背景 |
| `tabBg` | `rgba(245,242,235,0.9)` | `rgba(17,18,22,0.9)` | タブバー（半透明）※Web は不透明 |
| `accent` | `#2A66C4` | `#7FB2FF` | リンク・強調 |
| `hatch` | `repeating-linear-gradient(135deg, rgba(27,26,23,.06) 0 4px, transparent 4px 8px)` | 同左 `rgba(255,255,255,.06)` | 未計測日の斜線 ※Web は破線ボーダー |

### ⚠️ 面ごとの上書き（Web にこの表をそのまま渡さないこと）
`tabBg` と `hatch` は **react-native-web で生き残りません**。`ST Web.dc.html` は既に置き換え済みで、Web をデザイン/実装するときは必ずこちらを使う:

| token | iOS / Android / macOS | **Web (RN-web)** |
|---|---|---|
| `tabBg` | 上表の半透明 `rgba(...,0.9)` | **`bg` と同値の不透明単色**（light `#F5F2EB` / dark `#111216`） |
| `hatch` | `repeating-linear-gradient` の斜線 | **`1.5px dashed {line}` ＋ `chip` の塗り** |

他のトークンは全面共通。

## 2. Activity palette — **バックエンドのデータ。スタイルではない**

`PALETTE` の8色。ユーザーが `cycleColor` で各活動に割り当て、Convex の `activities` 行に保存される。
→ **全プラットフォームでバイト単位で一致必須**。Web 側が別の緑を発明すると同じ活動が端末ごとに違う色で出る。

```js
PALETTE = ['#E0A431', '#3B7BD9', '#4FA877', '#6C63D6', '#E0684A', '#D8579C', '#2BA3B5', '#8A6A4B']
```

既定の6活動（`iconKey` はアイコンセットのキー）:

| id | name | color | iconKey |
|---|---|---|---|
| `house` | 家事 | `#E0A431` | `home` |
| `work` | 仕事 | `#3B7BD9` | `work` |
| `rest` | 休息 | `#4FA877` | `rest` |
| `sleep` | 睡眠 | `#6C63D6` | `sleep` |
| `meal` | 食事 | `#E0684A` | `meal` |
| `fun` | 娯楽 | `#D8579C` | `fun` |

残り2色 `#2BA3B5` / `#8A6A4B` はユーザー追加項目用の予備。

## 3. Type

`font-family: 'Sora', 'Noto Sans JP', sans-serif`（英数=Sora / 和文=Noto Sans JP）
経過時間の数字は tabular-nums。スケール: 10 / 12 / 14 / 16 / 18 / 20 / 28px。

## 4. Radius

チップ 14–18 / カード 18–22 / シート 30（上端のみ）/ ピル 9999。

## 5. アクティブ状態の表現（全面共通ルール）

選択中の活動ボタン: `background: activity.color` / `color: #fff` / `border: activity.color`
`box-shadow: 0 10px 24px -8px {activity.color}`。非選択は `surface` + `line`。

---

## 検証

Web / menubar のデザインを取得したら、リストに無い hex が混入していないか確認:

```sh
cd design && grep -ohiE '#[0-9a-f]{6}' 'ST Web.dc.html' 'ST Menubar.dc.html' \
  | tr 'a-f' 'A-F' | sort -u \
  | grep -viE '#(F5F2EB|111216|FFFFFF|1B1C22|1C1D22|1B1A17|F2EFE8|2A66C4|7FB2FF|E0A431|3B7BD9|4FA877|6C63D6|E0684A|D8579C|2BA3B5|8A6A4B)'
```

出力が空なら OK。
