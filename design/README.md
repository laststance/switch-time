# Design source

正は **`switch-time.pen`**（pen.dev のドキュメント。プリティ JSON なので巻き戻しは git）。

## ファイル

- `switch-time.pen` — 全フレーム（ST Phone 7 枚＋訂正シートの持ち越し行 2 枚・ST Menubar・ST Web 2 枚＋訂正シートの状態行・訂正シートのタップのない日の注記・設定のタイムゾーン行の状態・ホームの detox の状態の各ボード＋サインイン（登録後）1 枚）、変数 37 個、`mode: light / dark` のテーマ軸
  - 訂正シートがあるのは Phone（全画面のシート）と Web（幅 560 の中央ダイアログ）だけ。Menubar には訂正の入口が無い（デザインにもコードにも）
- `PEN-MIGRATION.md` — Claude Design → pen.dev 移行の記録と、pen で実測してハマった点（自動保存なし・スクロールなし・フォント近似・MCP の接続先）
- `tokens.md` — トークンの人間向け解説。**機械が読む正は `../design-system/styles.css` と `theme.json`**

## 編集

`open -a Pen design/switch-time.pen` で開き、保存は Cmd+S（自動保存は無い）。**1 作業 = 保存 = コミット。**
エージェントから触る手順と罠は `PEN-MIGRATION.md` を読む。

ルート同士が重なっていないかの確認:

```sh
jq -r '.children[] | "\(.name)  x=\(.x)..\(.x+.width)  y=\(.y)..\(.y+.height)"' design/switch-time.pen
```

## 履歴

Claude Design 時代（2026-09-07 まで）の成果物 — `*.dc.html`、`support.js`、`ios-frame.jsx`、`verify-canvas.sh` と `baseline/`、
`dial-*.html` などの試作、`pull-canvas.sh`、`next-canvas-prompt.md` — は 2026-09-16 に削除した。
参照は `git show 552ac73:design/<file>`、当時の Claude Design プロジェクト ID や pull 手順は `git show 552ac73:design/README.md`。
