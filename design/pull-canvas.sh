#!/bin/bash
# Extract the LAST (newest) get_file result for $1 from the session JSONL -> $2.
# "Newest", not "longest": a change that shrinks the file breaks longest-wins.
set -u
J="/Users/ryotamurakami/.claude/projects/-Users-ryotamurakami-laststance-switch-time/03051036-0772-47e0-9321-5cbf28a3c00e.jsonl"
jq -c --arg n "$1" '
  select(.message.content != null) | .message.content[]?
  | select(.type=="tool_result") | .content
  | if type=="array" then .[]?.text else . end
  | select(type=="string") | select(startswith("{\"method\":\"get_file\""))
  | fromjson | select(.path == $n) | .content
' "$J" 2>/dev/null | tail -1 | jq -r '.' > "$2"
[ -s "$2" ] || { echo "$1: NOT FOUND"; exit 1; }
echo "$1 -> $2 ($(wc -c < "$2") bytes)"
