#!/bin/bash
# Extract the NEWEST get_file result for $1 -> $2.
# "Newest", not "longest": a change that shrinks the file breaks longest-wins.
# Results >25KB never reach the JSONL — the harness spills them to
# tool-results/*.txt — so both stores have to be searched, newest first.
set -u
BASE="/Users/ryotamurakami/.claude/projects/-Users-ryotamurakami-laststance-switch-time"
SESSION=$(ls -t "$BASE"/*.jsonl 2>/dev/null | head -1)
SID=$(basename "$SESSION" .jsonl)

# 1) spilled tool results (newest file wins)
for f in $(ls -t "$BASE/$SID/tool-results/"*.txt 2>/dev/null); do
  if jq -e --arg n "$1" 'select(.method=="get_file") | select(.path==$n)' "$f" >/dev/null 2>&1; then
    jq -r '.content' "$f" > "$2"
    [ -s "$2" ] && { echo "$1 -> $2 ($(wc -c < "$2") bytes, spilled)"; exit 0; }
  fi
done

# 2) inline results in the session JSONL
jq -c --arg n "$1" '
  select(.message.content != null) | .message.content[]?
  | select(.type=="tool_result") | .content
  | if type=="array" then .[]?.text else . end
  | select(type=="string") | select(startswith("{\"method\":\"get_file\""))
  | fromjson | select(.path == $n) | .content
' "$SESSION" 2>/dev/null | tail -1 | jq -r '.' > "$2"
[ -s "$2" ] || { echo "$1: NOT FOUND"; exit 1; }
echo "$1 -> $2 ($(wc -c < "$2") bytes, inline)"
