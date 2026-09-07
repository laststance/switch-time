# 次のキャンバス再生成プロンプト（時計の針＋タイプスケール）

対象: ST Phone / ST Web / ST Menubar / Settings Modal / Switch Time の5ファイル。
**日本語の文言・レイアウト構造・色・角丸・端末フレームは1文字も変えない。**
変えるのは (A) 時計の針と中心キャップ (B) font-size の数値 の2つだけ。

---

## A. 時計の針をドーフィン形の `<path>` にする

`viewBox="0 0 200 200"` のダイヤルだけが対象。**`viewBox="0 0 120 120"` の小型ウィジェット時計（`cx="60"`）は一切触らない。**
`{{ hDeg }}` / `{{ mDeg }}` / `{{ sDeg }}` の `transform="rotate(...)"` は**そのまま維持**すること。

### A-1. 時針・分針を `<line>` → `<path>` に

以下の3バリアントがある。**stroke-width と y2 で見分ける**。

**V1 標準**（ST Phone ×1 / ST Web ×1 / Switch Time ×2）
```
旧: <line x1="100" y1="106" x2="100" y2="52" stroke="{{ ink }}" stroke-width="6" stroke-linecap="round" transform="rotate({{ hDeg }} 100 100)"></line>
新: <path d="M100 51 L103.2 72 L101.6 104 L98.4 104 L96.8 72 Z" fill="{{ ink }}" stroke="{{ ink }}" stroke-width="1.2" stroke-linejoin="round" transform="rotate({{ hDeg }} 100 100)"></path>

旧: <line x1="100" y1="108" x2="100" y2="32" stroke="{{ ink }}" stroke-width="4" stroke-linecap="round" transform="rotate({{ mDeg }} 100 100)"></line>
新: <path d="M100 29 L102.4 56 L101.3 104 L98.7 104 L97.6 56 Z" fill="{{ ink }}" stroke="{{ ink }}" stroke-width="1" stroke-linejoin="round" transform="rotate({{ mDeg }} 100 100)"></path>
```

**V2 大型**（Switch Time ×1。`stroke-width="10"` / `"7"` が目印）
```
旧: <line x1="100" y1="108" x2="100" y2="50" ... stroke-width="10" ... rotate({{ hDeg }} ...)></line>
新: <path d="M100 49 L105.33 71 L102.67 104 L97.33 104 L94.67 71 Z" fill="{{ ink }}" stroke="{{ ink }}" stroke-width="1.6" stroke-linejoin="round" transform="rotate({{ hDeg }} 100 100)"></path>

旧: <line x1="100" y1="110" x2="100" y2="28" ... stroke-width="7" ... rotate({{ mDeg }} ...)></line>
新: <path d="M100 27 L104.2 55 L102.28 104 L97.72 104 L95.8 55 Z" fill="{{ ink }}" stroke="{{ ink }}" stroke-width="1.3" stroke-linejoin="round" transform="rotate({{ mDeg }} 100 100)"></path>
```

**V3 やや短**（Switch Time ×1。`y2="54"` / `y2="36"` が目印）
```
旧: <line x1="100" y1="106" x2="100" y2="54" ... stroke-width="6" ... rotate({{ hDeg }} ...)></line>
新: <path d="M100 53 L103.2 73 L101.6 104 L98.4 104 L96.8 73 Z" fill="{{ ink }}" stroke="{{ ink }}" stroke-width="1.2" stroke-linejoin="round" transform="rotate({{ hDeg }} 100 100)"></path>

旧: <line x1="100" y1="108" x2="100" y2="36" ... stroke-width="4" ... rotate({{ mDeg }} ...)></line>
新: <path d="M100 33 L102.4 59 L101.3 104 L98.7 104 L97.6 59 Z" fill="{{ ink }}" stroke="{{ ink }}" stroke-width="1" stroke-linejoin="round" transform="rotate({{ mDeg }} 100 100)"></path>
```

### A-2. 秒針に尾とカウンターウェイトを付ける

秒針は `<line>` のまま。**尾を中心の反対側へ伸ばし、丸い錘を足す。**
`<sc-if value="{{ showSeconds }}">` の中にあるものはその中のまま。

```
旧: <line x1="100" y1="112" x2="100" y2="24" stroke="{{ curColor }}" stroke-width="1.5" stroke-linecap="round" transform="rotate({{ sDeg }} 100 100)"></line>
新: <g transform="rotate({{ sDeg }} 100 100)"><line x1="100" y1="120" x2="100" y2="24" stroke="{{ curColor }}" stroke-width="1.2" stroke-linecap="round"></line><circle cx="100" cy="116" r="3.4" fill="{{ curColor }}"></circle></g>
```
`y2="30"` の秒針（Switch Time ③）も同じ扱いで、`y2` だけ `30` を維持する。

### A-3. 中心を平らな円からジュエルキャップにする

**必ず針より後ろ（あと）に描く**こと。順序は face → 目盛り → 時針 → 分針 → 秒針 → キャップ。

```
旧: <circle cx="100" cy="100" r="4.5" fill="{{ curColor }}"></circle>
新: <circle cx="100" cy="100" r="5.6" fill="{{ face }}" stroke="{{ ink }}" stroke-width="1.4"></circle><circle cx="100" cy="100" r="2.6" fill="{{ curColor }}"></circle><circle cx="100" cy="100" r="0.9" fill="{{ face }}"></circle>

旧: <circle cx="100" cy="100" r="8" fill="{{ curColor }}"></circle>   ← V2 大型のみ
新: <circle cx="100" cy="100" r="8.2" fill="{{ face }}" stroke="{{ ink }}" stroke-width="1.8"></circle><circle cx="100" cy="100" r="3.8" fill="{{ curColor }}"></circle><circle cx="100" cy="100" r="1.3" fill="{{ face }}"></circle>
```

グラデーション・`filter`・グローは**使わない**。同心円の平塗りとヘアラインだけで立体に見せる。

---

## B. font-size を7段のスケールに揃える

現状 19 サイズが混在している。**下表のとおり機械的に置換**。表に無い値が出てきたら、直近の下の段に丸める。
`font-size:` も `font:` 短縮指定の中の数値も両方が対象。**行送り（`/1.25` など）とウェイトは変えない。**

| 旧 | → 新 | トークン |
|---|---|---|
| 10, 11 | **10** | `--text-2xs` |
| 12, 13 | **12** | `--text-xs` |
| 14, 15 | **15** | `--text-sm` |
| 16, 17, 18 | **18** | `--text-md` |
| 20, 22 | **22** | `--text-lg` |
| 24, 26, 28, 30 | **28** | `--text-xl` |
| 36, 40, 46 | **40** | `--text-2xl` |
| **52** | **52 のまま（変えない）** | `--text-display` |

52px は経過時間のヒーロー数字。**縮めないこと。** 段差は上に行くほど広がる（2/3/3/4/6/12）設計で、旧 14/16/18/20 の +2px 等差が「4サイズが1つに見える」原因だった。

SVG の `width` / `height` / `r` / `stroke-width`、アイコンの寸法は **font-size ではないので対象外**。

---

## 触らないもの

- 端末フレーム 48px / ウィジェット 36px・26px / menubar ポップオーバー外枠 12px
- 角丸3段階（コントロール10 / コンテナ16 / シート28）— **カウントが1つでも動いたら失敗**
- 盤面のリム1px・目盛り3段階・活動リング 1.5px・face の色
- 活動パレットの8色、`rgba(0,0,0,0.18)` のウィジェット影
- フォントスタック（`-apple-system, BlinkMacSystemFont, ...`）
- **日本語の文言すべて**
- `viewBox="0 0 120 120"` の小型時計と `{{ nowDeg }}` のマーカー線

## 受け入れ確認

`design/verify-canvas.sh *.dc.html` が5ファイルとも PASS すること。
角丸カウントと日本語文言は `design/baseline/` と**完全一致**でなければならない。
