#!/usr/bin/env bash
# escalate.sh — UserPromptSubmit hook: heuristic complexity classification.
# Reads the hook payload (user prompt), classifies LOW/MED/HIGH/CRIT by
# keywords + prompt length, emits an [ESCALATION:<LEVEL>] tag on stdout
# (same mechanism as the [PANTHEON:role] conductor tag) and logs via plog.
# Never fails: any error degrades to "no tag" (exit 0).
set -u
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=pantheon-lib.sh
source "$LIB_DIR/pantheon-lib.sh"

payload="$(cat)"
sid=$(printf '%s' "$payload" | jq -r '.session_id // empty' 2>/dev/null || true)
prompt=$(printf '%s' "$payload" | jq -r '.prompt // .message // empty' 2>/dev/null || true)
[ -z "$prompt" ] && exit 0

# Lowercase copy for case-insensitive keyword matching (RU + EN).
low=$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')
len=${#prompt}
score=0

# Keyword classes. Score weights:
#   CRIT class +4 (data-loss / security / production / architecture / migration)
#   HIGH class +2 (refactor / multi-system / deep review requests)
#   MED  class +1 (new integrations, libraries, config, tests)
# Thresholds: 0=LOW, 1-3=MED, 4-7=HIGH, >=8=CRIT
# (one CRIT keyword → HIGH; two → CRIT; three plain MED words stay MED)
CRIT_KW='архитектур|миграци|безопасн|production|депло|релиз|схем|парол|secret|шифров|уничтож|data loss|security|architecture|migration|encrypt'
HIGH_KW='рефактор|переписа|интеграц|многосистем|транзакц|производительн|конкурент|ревью|review|audit|аудит|performance|redesign|фундамент'
MED_KW='библиотек|library|api|зависимост|настро|config|тест|test|модул|плагин|plugin|hook'

count_kw() { # count_kw <regex> — number of keyword hits in the prompt
  local re="$1" n=0 w
  IFS='|' read -ra words <<< "$re"
  for w in "${words[@]}"; do
    [ -z "$w" ] && continue
    printf '%s' "$low" | grep -qF "$w" && n=$((n + 1))
  done
  printf '%s' "$n"
}

crit_hits=$(count_kw "$CRIT_KW")
high_hits=$(count_kw "$HIGH_KW")
med_hits=$(count_kw "$MED_KW")

score=$((crit_hits * 4 + high_hits * 2 + med_hits * 1))
# Long prompts need more context/plan work → bump the score.
[ "$len" -gt 500 ] && score=$((score + 1))
[ "$len" -gt 1500 ] && score=$((score + 1))

level="LOW"
[ "$score" -ge 1 ] && level="MED"
[ "$score" -ge 4 ] && level="HIGH"
[ "$score" -ge 8 ] && level="CRIT"

plog "info" "escalate.sh" "${sid:- -}" "classify" \
  "level=$level score=$score len=$len crit=$crit_hits high=$high_hits med=$med_hits"

# Tag for the conductor: react per "Auto-escalation" rules in pantheon-conductor.
printf '[ESCALATION:%s]\n' "$level"
exit 0
