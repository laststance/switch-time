# 次のキャンバス再生成プロンプト（フォント刷新＋時計の質感）

5ファイル全部（ST Phone / ST Web / ST Menubar / Settings Modal / Switch Time）に機械的に適用。
**レイアウト・文言・数値・ロジックは変えない**（例外は F の1箇所だけ）。

## A. ウェブフォントを完全に外す
- `<helmet>` 内の Google Fonts への `<link rel="preconnect">` と `<link href="...fonts.googleapis.com...">`、
  CSS の `@import url(...fonts.googleapis...)` を**全削除**。
- 文字列 `Mona Sans` がどのファイルにも **0個**になること。

## B. font 指定を1本のスタックに統一
すべての `font-family` / `font:` 短縮指定の書体部分を、例外なくこれに置換:

```
-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', Roboto, 'Hiragino Sans', 'Yu Gothic UI', 'Noto Sans JP', sans-serif
```

- **`'Noto Sans JP',sans-serif` という短い指定が `ST Phone.dc.html` に53箇所残っている。これも同じスタックへ。**
  他4ファイルにも同じ形が無いか確認すること。
- ウェイトとサイズは現状維持。書体名だけ差し替える。

## C. 盤面の色を surface と分ける
`renderVals()` の theme オブジェクト:
- dark: `face: '#1B1C22'` → **`face: '#212229'`**
- light: `face: '#FFFFFF'` → **`face: '#FBF9F4'`**

`bg` / `surface` / `sheetBg` は**触らない**。

## D. 盤面の影を外してリムにする
- 時計 SVG の `style="filter: drop-shadow(0 14px 30px rgba(0,0,0,0.12));"` を**削除**（ST Phone と Switch Time の2箇所）。
- 代わりに盤面の円 `<circle cx="100" cy="100" r="90" fill="{{ face }}">` に
  `stroke="{{ line }}" stroke-width="1"` を追加。
- `filter` は react-native-web が落とすので Web ではもともと消える。`drop-shadow` が全ファイル0個になること。

## E. 目盛りを2段階→3段階
現在（ST Phone / ST Web / Switch Time の3ファイル）:
```js
const ticks = Array.from({ length: 60 }, (_, i) => { const major = i % 5 === 0;
  return { deg: i*6, y2: major ? 26 : 21, w: major ? 2.5 : 1, stroke: major ? C.ink : C.line }; });
```
これを:
```js
const ticks = Array.from({ length: 60 }, (_, i) => {
  const quarter = i % 15 === 0, hour = i % 5 === 0;
  return { deg: i*6, y2: quarter ? 30 : hour ? 26 : 20,
           w: quarter ? 3 : hour ? 2 : 1,
           stroke: quarter ? C.ink : hour ? C.sub : C.line };
});
```

## F. 文言変更はここ1箇所だけ
`Switch Time.dc.html` の書体見本ラベル
「**Mona Sans 600** · 数字・経過時間」→「**System 600** · 数字・経過時間」（A の 0個条件のため）。

## 触らないもの
- 端末フレーム 48px / ウィジェット 36px・26px / menubar ポップオーバー外枠 12px
- 角丸3段階（コントロール10 / コンテナ16 / シート28）
- `rgba(0,0,0,0.18)` のウィジェット影4つ（中立な影なので残す）
- アクティブ状態は「塗り＋同色ボーダー＋白文字」のみ。グローは足さない
- 活動パレットの8色

## 受け入れ確認
`/tmp/verify-canvas.sh 'ST Phone.dc.html' ...` — noto-first / Mona Sans / googleapis / drop-shadow / Sora が全部 0、
`-apple-system` が >0、端末クロームの角丸カウントが前後で不変。
