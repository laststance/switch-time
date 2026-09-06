#!/bin/bash
# Acceptance check for a regenerated canvas page.
# Asserts absence first — that is the half that was missing last pass.
cd /Users/ryotamurakami/laststance/switch-time/design || exit 1
c() { grep -o "$1" "$2" 2>/dev/null | wc -l | tr -d ' '; }
ck() { # want expr, got, label
  if [ "$2" = "$1" ] || { [ "$1" = ">0" ] && [ "$3" -gt 0 ] 2>/dev/null; }; then :; fi
}
for f in "$@"; do
  echo "── $f"
  n_noto=$(c "'Noto Sans JP',sans-serif" "$f")
  n_mona=$(c 'Mona Sans' "$f")
  n_imp=$(c 'fonts.googleapis' "$f")
  n_ds=$(c 'drop-shadow' "$f")
  n_sys=$(grep -oe "-apple-system" "$f" | wc -l | tr -d " ")
  n_sora=$(c 'Sora' "$f")
  for pair in "noto-first:$n_noto:0" "Mona Sans:$n_mona:0" "googleapis:$n_imp:0" \
              "drop-shadow:$n_ds:0" "Sora:$n_sora:0"; do
    IFS=: read -r lbl got want <<< "$pair"
    [ "$got" = "$want" ] && s="OK " || s="FAIL"
    printf "  %s %-14s %s (want %s)\n" "$s" "$lbl" "$got" "$want"
  done
  [ "$n_sys" -gt 0 ] && s="OK " || s="FAIL"
  printf "  %s %-14s %s (want >0)\n" "$s" "-apple-system" "$n_sys"
  # device chrome must not move
  printf "  chrome radii 48/36/26/12: %s/%s/%s/%s\n" \
    "$(c 'border-radius:48px' "$f")" "$(c 'border-radius:36px' "$f")" \
    "$(c 'border-radius:26px' "$f")" "$(c 'border-radius:12px' "$f")"
done
