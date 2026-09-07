#!/bin/bash
# Acceptance check for a regenerated canvas page.
# Asserts absence first — that is the half that was missing two passes ago.
# Then diffs against baseline/ so a remap cannot silently move a radius or
# reword a Japanese label while every font-size assertion still passes.
cd /Users/ryotamurakami/laststance/switch-time/design || exit 1
c() { grep -o -e "$1" "$2" 2>/dev/null | wc -l | tr -d ' '; }

rc=0
for f in "$@"; do
  b="baseline/${f%.dc.html}"
  echo "── $f"
  fail=0
  # webfont era must stay gone
  for t in "Mona Sans" "Sora" "fonts.googleapis" "drop-shadow" "dialShadow" "'Noto Sans JP',sans-serif"; do
    got=$(c "$t" "$f")
    [ "$got" = 0 ] && s="OK " || { s="FAIL"; fail=1; }
    printf "  %s %-26s %s (want 0)\n" "$s" "$t" "$got"
  done
  got=$(c "-apple-system" "$f")
  [ "$got" -gt 0 ] && s="OK " || { s="FAIL"; fail=1; }
  printf "  %s %-26s %s (want >0)\n" "$s" "-apple-system" "$got"

  # 端末クロームは動いてはいけない — baseline と完全一致
  grep -oE 'border-radius:[0-9]+px' "$f" | grep -oE '[0-9]+' | sort -n | uniq -c \
    | awk '{print $2" "$1}' > /tmp/.radii.$$
  if diff -q "$b.radii" /tmp/.radii.$$ >/dev/null 2>&1; then
    printf "  OK  %-26s baseline と一致\n" "角丸カウント"
  else
    printf "  FAIL %-25s baseline と差分:\n" "角丸カウント"; diff "$b.radii" /tmp/.radii.$$ | sed 's/^/       /'; fail=1
  fi

  # 日本語文言は1文字も変わってはいけない
  grep -oE '[ぁ-んァ-ヶ一-龠々ー]+' "$f" | sort -u > /tmp/.jp.$$
  if diff -q "$b.jp" /tmp/.jp.$$ >/dev/null 2>&1; then
    printf "  OK  %-26s baseline と一致 (%s 種)\n" "日本語文言" "$(wc -l < /tmp/.jp.$$ | tr -d ' ')"
  else
    printf "  FAIL %-25s baseline と差分:\n" "日本語文言"; diff "$b.jp" /tmp/.jp.$$ | sed 's/^/       /'; fail=1
  fi
  rm -f /tmp/.radii.$$ /tmp/.jp.$$

  [ "$fail" = 0 ] && echo "  → PASS" || { echo "  → FAIL"; rc=1; }
done
exit $rc
