#!/usr/bin/env bash
# 共享验收门：pi 交付前自己跑（不带 --full），主 agent 验收跑 --full。
# 所有结果行以 GATE: 开头；没有 GATE: 行 = 输出崩坏。
#
#   gate.sh <manifest.json> --baseline   # 派发前抓基线用例名单
#   gate.sh <manifest.json>              # pi 自检（跳过回退验红）
#   gate.sh <manifest.json> --full       # 主 agent 验收（含回退验红）
#
# manifest 字段见 docs/agent-optimization/manifests/_template.json

set -uo pipefail

MANIFEST="${1:?用法: gate.sh <manifest.json> [--baseline|--full]}"
MANIFEST="$(cd "$(dirname "$MANIFEST")" && pwd)/$(basename "$MANIFEST")"
MODE="${2:-self}"
GIT=/usr/bin/git

WT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$WT" || exit 90

q() { bun -e "const m=require('$MANIFEST');const v=m['$1'];console.log(Array.isArray(v)?v.join('\n'):(v??''))" 2>/dev/null; }

ID="$(q id)"
ALLOWED="$(q allowed_files)"
SOURCES="$(q source_files)"
TESTS="$(q test_files)"
MAXLINES="$(q max_source_lines)"
BANNED="$(q banned_patterns)"
[ -z "$MAXLINES" ] && MAXLINES=400

BASEDIR="$WT/docs/agent-optimization/baselines"
mkdir -p "$BASEDIR"
CASEFILE="$BASEDIR/$ID.cases"

# 用例名单：从测试文件里抽 describe/test/it 的标题。
collect_cases() {
  for f in $TESTS; do
    [ -f "$f" ] || continue
    grep -hoE '^[[:space:]]*(describe|test|it)(\.[a-zA-Z]+)?[[:space:]]*\([[:space:]]*["'"'"'`][^"'"'"'`]*' "$f" \
      | sed -E 's/^[[:space:]]*//; s/[[:space:]]*\([[:space:]]*["'"'"'`]/|/' \
      | sed "s|^|$f::|"
  done | sort
}

if [ "$MODE" = "--baseline" ]; then
  collect_cases > "$CASEFILE"
  echo "GATE: baseline id=$ID cases=$(wc -l < "$CASEFILE")"
  echo "GATE: baseline-head=$($GIT rev-parse --short HEAD)"
  exit 0
fi

FAIL=0
note() { echo "GATE: $1"; }
bad()  { echo "GATE: $1"; FAIL=1; }

note "id=$ID mode=$MODE head=$($GIT rev-parse --short HEAD)"

# 1. 越界：改动文件必须全在白名单内
CHANGED="$($GIT status --porcelain | sed -E 's/^.{3}//' | sed 's/.* -> //')"
OOB=0
for f in $CHANGED; do
  case "$f" in
    docs/agent-optimization/*) continue ;;
  esac
  if ! echo "$ALLOWED" | grep -qxF "$f"; then
    bad "out-of-bounds $f"
    OOB=1
  fi
done
[ "$OOB" = 0 ] && note "out-of-bounds none"

# 2. 改动规模
TOTAL=0
for f in $SOURCES; do
  n="$($GIT diff --numstat HEAD -- "$f" | awk '{s+=$1+$2} END{print s+0}')"
  TOTAL=$((TOTAL + n))
done
if [ "$TOTAL" -gt "$MAXLINES" ]; then
  bad "size source-lines=$TOTAL limit=$MAXLINES EXCEEDED"
else
  note "size source-lines=$TOTAL limit=$MAXLINES"
fi

# 3. 禁用写法
if [ -n "$BANNED" ]; then
  DIFF="$($GIT diff HEAD -- $ALLOWED)"
  BHIT=0
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    if echo "$DIFF" | grep -qE "$p"; then bad "banned-pattern $p"; BHIT=1; fi
  done <<< "$BANNED"
  [ "$BHIT" = 0 ] && note "banned-pattern none"
fi

# 4. 现有用例不丢
if [ -f "$CASEFILE" ]; then
  NOW="$(collect_cases)"
  MISSING="$(comm -23 "$CASEFILE" <(echo "$NOW"))"
  if [ -n "$MISSING" ]; then
    bad "cases-missing $(echo "$MISSING" | wc -l)"
    echo "$MISSING" | sed 's/^/GATE:   lost /'
  else
    note "cases-missing none (baseline=$(wc -l < "$CASEFILE") now=$(echo "$NOW" | wc -l))"
  fi
else
  bad "cases-baseline MISSING (先跑 --baseline)"
fi

# 5. typecheck
if bun run typecheck > /tmp/gate-tc.$$ 2>&1; then
  note "typecheck PASS"
else
  bad "typecheck FAIL"; tail -25 /tmp/gate-tc.$$ | sed 's/^/GATE:   /'
fi
rm -f /tmp/gate-tc.$$

# 6. lint
if bun run lint > /tmp/gate-lint.$$ 2>&1; then
  note "lint PASS"
else
  bad "lint FAIL"; tail -25 /tmp/gate-lint.$$ | sed 's/^/GATE:   /'
fi
rm -f /tmp/gate-lint.$$

# 7. 相关测试必须全绿
if [ -n "$TESTS" ]; then
  if bun test --parallel $TESTS > /tmp/gate-test.$$ 2>&1; then
    note "tests PASS ($(grep -cE '^\(pass\)' /tmp/gate-test.$$ || echo '?') pass)"
  else
    bad "tests FAIL"; tail -35 /tmp/gate-test.$$ | sed 's/^/GATE:   /'
  fi
  rm -f /tmp/gate-test.$$
fi

# 8. 回退验红（只在 --full）：源码换回 HEAD，测试必须变红。
#    专抓「用例空转却报已覆盖」。
if [ "$MODE" = "--full" ] && [ -n "$TESTS" ] && [ -n "$SOURCES" ]; then
  TMP="$(mktemp -d)"
  SUMBEFORE="$(sha256sum $SOURCES 2>/dev/null)"
  for f in $SOURCES; do
    mkdir -p "$TMP/$(dirname "$f")"
    cp "$f" "$TMP/$f" 2>/dev/null
    if $GIT cat-file -e "HEAD:$f" 2>/dev/null; then
      $GIT show "HEAD:$f" > "$f"
    else
      rm -f "$f"   # pi 新建的源码文件：回退 = 删除
    fi
  done
  if bun test --parallel $TESTS > /tmp/gate-revert.$$ 2>&1; then
    bad "revert-red FAIL 源码退回 HEAD 后测试仍然全绿 = 用例没有真正覆盖改动"
  else
    note "revert-red PASS (退回 HEAD 后测试变红，符合预期)"
  fi
  rm -f /tmp/gate-revert.$$
  for f in $SOURCES; do
    if [ -f "$TMP/$f" ]; then cp "$TMP/$f" "$f"; fi
  done
  if [ "$(sha256sum $SOURCES 2>/dev/null)" = "$SUMBEFORE" ]; then
    note "restore PASS (源码已还原，校验和一致)"
  else
    bad "restore FAIL 源码未能还原，手工检查 $TMP"
  fi
  rm -rf "$TMP"
fi

if [ "$FAIL" = 0 ]; then
  note "RESULT PASS id=$ID"
else
  note "RESULT FAIL id=$ID"
fi
exit "$FAIL"
