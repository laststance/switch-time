# Design source (pulled from Claude Design)

Project: `Switch Time mobile app design` / `4b07af84-2468-4f18-bab7-d93e4329e3c0`

## Preview
`python3 -m http.server 8899` → http://localhost:8899/Switch%20Time.dc.html
(HTTP 必須。`<dc-import>` が兄弟ファイルを fetch するので `file://` では白紙)

## Re-pull (Claude Design で編集したあと)
Claude Code に「design/ を再取得して」と頼む (裏で `/design-login` + DesignSync `get_file`)。
push は不可 = 一方通行。このプロジェクトは `PROJECT_TYPE_PROJECT` で、書き込めるのは design-system 型のみ。

## ファイルの役割
- `Switch Time.dc.html` — キャンバス/仕様シート。下2つを `<dc-import>` する
- `ST Phone.dc.html` / `Settings Modal.dc.html` — iOS/Android の画面。**移植対象**
- `ST Menubar.dc.html` — macOS メニューバー版（420×600・dark 既定・右スライドイン設定パネル）。**移植対象**
- `ST Web.dc.html` — Web 版（1024×860・react-native-web 準拠）。**移植対象**
  `viewport` プロップで `fill` / `768` / `390` を切替。800px 未満で左レール → 下部タブバー
- `support.js` — 生成物 (dc-runtime)。**プレビュー専用・移植対象外**
- `ios-frame.jsx` — omelette starter のベゼル/ステータスバー/キーボード。
  `9:41`・Dynamic Island・iOS26 glass は**偽物**。デザイントークンとして読まないこと

## Format
`.dc.html` = `<x-dc>` テンプレート + `{{ }}` バインディング + `<sc-if>`/`<sc-for>`
     + `<script type="text/x-dc">` の `class Component extends DCLogic { renderVals() }`
props は `data-props` に `tsType` 付きで宣言済み → React への変換はほぼ機械的。

## Web 版の RN-web 制約（`ST Web.dc.html`）
Expo の単一コードベース前提（Bluesky と同構成）なので、以下は**使っていないし今後も入れない**:
`display:grid` / `position:sticky` / `backdrop-filter` / `filter` / `repeating-linear-gradient` / `::before` / `::after` / 多重 `box-shadow`

モバイル版から置き換えたもの:
- `tabBg` の半透明 → **不透明単色**（= `bg` と同値）
- 未計測日の `hatch` 斜線 → **破線ボーダー ＋ `chip` の塗り**

検証:
```sh
cd design && for p in 'display: *grid' 'position: *sticky' backdrop-filter repeating-linear-gradient '::before'; do
  echo "$p: $(grep -ciE "$p" 'ST Web.dc.html')"; done
```
全部 0 なら OK。

`ST Menubar.dc.html` は **意図的に `display:grid` を使っています**（切替カードの3×2、編集行の6カラム）。
macOS 専用（SwiftUI / AppKit 想定）なので問題なし。ただし **menubar を Electron や RN で作る方針に変えるなら、
この2箇所が移植コスト**になります。

---

## Claude Design のプロジェクトは2つある

| 役割 | 型 | projectId | 同期 |
|---|---|---|---|
| 試行キャンバス（画面案を出す場所） | `PROJECT_TYPE_PROJECT` | `4b07af84-2468-4f18-bab7-d93e4329e3c0` | **取得のみ**。`design/` へ pull |
| デザインシステム（トークンの正） | `PROJECT_TYPE_DESIGN_SYSTEM` | `e7060f31-8730-4e9b-ba97-eff4b10b1b80` | **読み書き**。`design-system/` から `/design-sync` |

型は作成時に固定で変更不可。前者を後者に昇格させることはできません。

`design-system/` が push 元、`design/` が pull 先です。新しい面をデザインするときは
`design-system/theme.json` と `readme.md` が制約として効くので、`tokens.md` を手で貼る必要は
もうありません（キャンバス側プロジェクトにデザインシステムを紐付けた場合）。

**Claude Design が何を変えたかは git diff で読みます。1 pull = 1 commit** を守ってください。
