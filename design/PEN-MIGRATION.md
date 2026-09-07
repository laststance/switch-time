# Claude Design → pen.dev 移行

調査日 2026-09-07。動機は **Claude Design に巻き戻しが無い**こと。

## 結論：解決する

`.pen` は **JSON テキスト**（`version` / `children` / `variables` / `themes`）。公式が
「Commit `.pen` files like code files」「View diffs in Git」と明言。巻き戻し = `git checkout`。

`design/switch-time.pen` を作成済み（`{"version":"2.17","children":[]}` が有効な最小ファイル）。

## 接続方法（GUI クリック不要）

pencil MCP は「エディタで開いているファイル」に対して動く。`execute` に `filePath` を渡しても
**開いていなければ失敗する**（`Failed to access file "..." A file needs to be open in the editor`）。

```sh
open -a Pen design/switch-time.pen   # これだけで MCP が繋がる
```

以降 `get_app_state` / `execute` / `browser` が全部通る。CLI 認証は不要。

## 取り込み方法（実証済み）

公式ドキュメントには「HTML / URL インポートは無い」と書いてあるが、**アプリには有る**。
`browser` MCP の `import-to-canvas` が生ページを編集可能な pen レイヤーに再構築する
（ダッシュボードの "Import from browser" と同じ）。ツールスキーマが正、ドキュメントは古い。

```sh
cd design && python3 -m http.server 8899   # <dc-import> が fetch するので HTTP 必須
```

```
browser load-page      → http://localhost:8899/<file>.html
browser return-screenshot  → ★ ここが関門。描画を目視してから取り込む
browser import-to-canvas   → full-page
```

### 幅を実寸に固定する

ブラウザ幅（~784px）で描画されるとレイアウトが崩れる。一時コピーに `<style>` を注入して解決：

```sh
sed 's|</head>|<style>html,body{width:402px;height:874px;margin:0;overflow:hidden}</style></head>|' \
  "ST Phone.dc.html" > _import-tmp.html
```

取り込み後 `rm _import-tmp.html`。

### セレクタの注意

`x-dc` / `dc-import` は **DOM に残らない**（dc-runtime が置換する）ので
`target: "query"` では狙えない。上記の幅固定 + `full-page` が正解。

## PoC 結果 — `ST Phone.dc.html`

`frame#NthRl` `402×844` `fill:#111216` `layout:"vertical"`、`ctx.problems` ゼロ（クリップ無し）。
**ドーフィン針・活動リング・6切替ボタン・24hバー・タブバー すべて再現**。
警告は `Per-side border colors are not supported; using the first.` の1件のみ。

→ **`pen --prompt` での作り直しは不要**。2セッション分の「AI っぽさ除去」がそのまま残る。

## 移行対象

| 対象 | 移行 | 方法 |
|---|---|---|
| `ST Phone.dc.html` | ✅ 済(PoC) | browser import（402×874） |
| `Settings Modal.dc.html` | ✅ | 同上。**単体だと props 空**なので `ST Phone` 経由で出す |
| `ST Menubar.dc.html` | ✅ | 同上（420×600） |
| `ST Web.dc.html` | ✅ | 同上（1024×860） |
| `design-system/styles.css` | ✅ | `SetVariables()` へ。`--text-*` 8段 + 色 + 半径 10/16/28 |
| `design-system/theme.json` の light/dark | ✅ | `{value, theme:{mode:"dark"}}` 配列。テーマ軸は自動登録 |
| `Switch Time.dc.html` | ❌ | 仕様シート。中身は上の4つ、取り込むと重複 |
| `support.js` / `ios-frame.jsx` | ❌ | 生成物 / 偽ベゼル |
| `dial-*.html` `scale-*.html` | ❌ | 意思決定用プロトタイプ、役目済み |

## 移行で消える TODO

- **#3 `theme.json` の `frame`/`density`** — `_ds_manifest.json` が stale でブロック中だったが、
  Claude Design 固有フィールド。pen には無い → **廃棄**
- **#4 `<helmet>` への `_ds_bundle.js` 注入** — 同上 → **廃棄**
- Fable 週次クォータ（リセット 09-09）も pen には無関係。pen は自前のモデルを持つ

## 注意点

- **自動保存が無い**。`execute` の変更はメモリ上のみ。実測: import 後もディスクは 42 bytes のまま。
  保存は Pen アプリで `Cmd+S`。エージェントからは `mcp__mac__activate_app("Pen")` +
  `mcp__mac__key_combination(["command"],"s")` で叩ける（実証済み）。
  git 運用の前提なので **1 作業 = 保存 = コミット** を守ること
- **`pen` CLI は未認証**（`pen status` → Not authenticated）。移行自体には不要（MCP で足りる）だが、
  `pen interactive -a desktop -i x.pen` の `save()` でエージェントから保存したいなら必要。
  対話ログインなのでユーザーが `! pen login` を実行する
- `.pen` 形式は「breaking changes を入れる権利を留保する」と明記あり。バージョン固定の保証は無い
- pen は CSS/HTML の概念をそのまま持たない。`%` / `calc()` / `margin` /
  `alignItems: baseline|stretch` は**エラーになる**

## 検査ハーネスの移行

`verify-canvas.sh` + `design/baseline/` は `.dc.html` 前提（角丸の grep、日本語文言）。
`.pen` は JSON なので `jq` に置き換えると**むしろ簡単**になる：

```sh
jq '[.. | objects | select(.radius) | .radius] | unique' switch-time.pen   # 半径が 10/16/28 だけか
jq -r '.variables["text-display"].value' switch-time.pen                   # 52px が潰れてないか
```

---

# 実行結果（2026-09-07）

`design/switch-time.pen` — 1.06MB / **25,008 行のプリティ JSON**（最長行 624 文字）。
`git diff` が普通に読める = 巻き戻しの目的を達成。

## 取り込んだ 9 フレーム

| 名前 | サイズ |
|---|---|
| ST Phone / ホーム | 402×844 |
| ST Phone / 記録・週 | 402×1140 |
| ST Phone / 記録・月 | 402×1140 |
| ST Phone / 訂正シート | 402×1478 |
| ST Phone / 設定＋除外シート | 402×1478 |
| ST Phone / 活動項目シート | 402×1478 |
| ST Phone / 初回起動 | 402×606 |
| ST Menubar | 420×600 |
| ST Web | 1024×1478 |

変数 37 個（色 18 + 数値 19）、テーマ軸 `mode: [light, dark]` を登録。

## 想定と違った点 2つ

### 1. 高さが 874px に収まらない — **仕様**

**pen にスクロールが無い**（スキル: "There is no scrolling and the entire content
should always be visible on the canvas"）。HTML 側で `overflow:auto` していた領域は
スクロール全長でレイアウトされる。`html,body{height:874px}` を入れても効かない。

崩れではない。週/月・各シート・Web をスクショで目視確認済み、内容は完全。
`ctx.problems` の `partially clipped` はグラフのラベル等で無害。
**デバイス実寸で見たいなら 402×874 の親フレームを別途置いて clip する**こと。

### 2. フォントが Roboto / Arial になった — **要判断**

取り込み結果は `Roboto` 378 ノード / `Arial` 35 ノード。
`-apple-system` を Chromium が解決できずスタックを落ちた結果で、
`mem:pattern_css-font-stack-resolution` の実測どおりの挙動。

pen は Google Fonts を描画するので **システムフォントスタックは原理的に表現できない**。
`Roboto` はスタックの Android 項そのものなので嘘ではないが、
「ウェブフォントを使わない」という決定とは表示上ズレる。

**正は `design-system/styles.css` のまま。pen 側は描画上の近似**、という扱いを推奨。
