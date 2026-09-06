# Switch Time — Design Tokens

`ST Phone.dc.html` / `Settings Modal.dc.html` の `renderVals()` から抽出（Claude Design のモバイル成果物が唯一の出典）。
**機械が読む正は `design-system/theme.json` ＋ `styles.css`**（Claude Design のデザインシステム側）。
このファイルは人間用のドキュメント。デザインシステムを紐付けていないキャンバスに投げるときだけ、そのまま貼る。

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
| font | RN の `fontFamily` は**スタック不可・1ファミリーのみ**。`expo-font` で `'Mona Sans'` を同梱し、和文は OS の字形フォールバックに任せる | 下の §3 のスタックをそのまま CSS に書ける |

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

```css
font-family: 'Mona Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI',
             'Hiragino Sans', 'Noto Sans JP', Helvetica, Arial, sans-serif;
```

英数字と数値は **Mona Sans**（GitHub 製のグロテスク、OFL-1.1、Google Fonts 配信）。
**和文はウェブフォントを載せず OS の標準書体**に落とす — Apple 面は Hiragino Sans、それ以外は Noto Sans JP。
GitHub 自身と同じ方針（ラテンだけ自前、CJK はシステム）。

見出しと本文は**同一スタック**。階層はウェイトとサイズだけで作り、2書体を混ぜない。
経過時間の数字は tabular-nums。スケール: 10 / 12 / 14 / 16 / 18 / 20 / 28px。

## 4. Radius / Spacing

3段階、比率およそ 1.6 倍。**丸みの差＝階層**なので、1つの大きめの値に揃えないこと（＝AI 生成モックの見た目）。

| 用途 | 値 |
|---|---|
| コントロール（ボタン・チップ） | **10** |
| コンテナ（カード・パネル） | **16** |
| シート（上端2隅のみ） | **28** |
| ピル | 9999 ※ステータス表示専用、ボタンには使わない |

**余白も同じ役割**。スケール 4/8/12/16/20/24/32 はそのままで良いが、**どこも `16` で埋めない**こと。
余白は「まとまり」の宣言 — 同じものに属する要素間は `4`/`8`、別のまとまりとの間は `20` 以上。
全部の箱を同じパディングにするのは、丸みを1つの値に揃えるのと同じで、何が近くて何が遠いのかが消える。

## 5. アクティブ状態の表現（全面共通ルール）

選択中の活動ボタン: `background: activity.color` / `color: #fff` / `border: activity.color`。
**それだけ。グローは付けない** — アクセント色で着色した drop shadow は「AI っぽさ」の最大の原因なので復活させないこと。
塗りだけで状態は十分伝わる。非選択は `surface` + `line`。

---

## 検証

Web / menubar のデザインを取得したら、リストに無い hex が混入していないか確認:

```sh
cd design && grep -ohiE '#[0-9a-f]{6}' 'ST Web.dc.html' 'ST Menubar.dc.html' \
  | tr 'a-f' 'A-F' | sort -u \
  | grep -viE '#(F5F2EB|111216|FFFFFF|1B1C22|1C1D22|1B1A17|F2EFE8|2A66C4|7FB2FF|E0A431|3B7BD9|4FA877|6C63D6|E0684A|D8579C|2BA3B5|8A6A4B)'
```

出力が空なら OK。
