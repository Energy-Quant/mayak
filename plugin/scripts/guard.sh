#!/usr/bin/env bash
# guard.sh — PreToolUse enforcement Пантеона
# Оракул: write/edit ТОЛЬКО в .pantheon/plans/*.md и .pantheon/analysis/*.md; shell — read-only
# Библиотекарь: write/edit ТОЛЬКО в .pantheon/digests/*.md; shell — read-only
# Goose / adhoc / неизвестные: allow (лог ведёт pantheon-log.sh)
# Сигналы блокировки: stdout {"decision":"block","reason":...} или exit 2 + stderr
set -euo pipefail
LIB_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=pantheon-lib.sh
source "$LIB_DIR/pantheon-lib.sh"

payload="$(cat)"
session_id=$(printf '%s' "$payload" | jq -r '.session_id // empty')
tool=$(printf '%s' "$payload" | jq -r '.tool_name // empty')
[ -z "$session_id" ] && exit 0

role=$(resolve_role "$session_id")
plog "debug" "guard.sh" "$session_id" "check" "tool=$tool role=$role"
case "$role" in
  goose|adhoc) exit 0 ;;
esac

block() { # block <reason> — блокирующее решение через stdout JSON
  plog "warn" "guard.sh" "$session_id" "blocked" "tool=$tool reason=$1"
  jq -n --arg r "$1" '{decision:"block", reason:$r}'
  exit 0
}

# ── Политика write/edit: только каталог артефактов роли ──────────────
if [ "$tool" = "developer__write" ] || [ "$tool" = "developer__edit" ]; then
  path=$(printf '%s' "$payload" | jq -r '.tool_input.path // empty')
  wdir=$(printf '%s' "$payload" | jq -r '.working_dir // empty')
  case "$path" in
    /*) : ;;
    *) [ -n "$wdir" ] && path="$wdir/$path" ;;
  esac
  case "$role" in
    oracle)
      printf '%s' "$path" | grep -Eq '/\.pantheon/(plans|analysis)/[^/]+\.md$' && exit 0
      block "[PANTHEON] Оракул может писать ТОЛЬКО в .pantheon/plans/*.md и .pantheon/analysis/*.md. Получено: $path. Policy: попроси conductor." ;;
    librarian)
      printf '%s' "$path" | grep -Eq '/\.pantheon/digests/[^/]+\.md$' && exit 0
      block "[PANTHEON] Библиотекарь может писать ТОЛЬКО в .pantheon/digests/*.md. Получено: $path. Policy: попроси conductor." ;;
  esac
fi

# ── Политика shell: read-only посегментно ─────────────────────────────
if [ "$tool" = "developer__shell" ]; then
  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')

  case "$cmd" in
    *'`'*|*'$('*|*'\n'*)
      block "[PANTHEON] shell роли '$role': подстановки команд (\` \` \$( )) запрещены (read-only)." ;;
  esac

  # сегменты: split по | ; && || (одиночный & — фон, запрещён ниже проверкой паттерна)
  printf '%s' "$cmd" | grep -Eq '(^|[^\&])\&([^\&]|$)' \
    && block "[PANTHEON] shell роли '$role': фоновый запуск '&' запрещён." || true

  READ_CMDS='ls|cat|head|tail|wc|tree|rg|grep|find|fd|jq|file|stat|du|df|which|env|printenv|date|uname|uptime|whoami|id|git|sqlite3|curl|wget|python3|python|cargo|rustc|npm|pnpm|sed|awk|cut|sort|uniq|diff|cmp|basename|dirname|realpath|readlink|md5sum|sha256sum|tar|unzip|zipinfo|ping|ip|ss|ps|echo|printf|test|true|type|command|nvidia-smi|sensors|free|psql|mongo|kubectl|helm|terraform|ansible|make|just|go|node|deno|bun|dotnet|java|javac|gcc|g\+\+|clang|rustup|west|meson|cmake|ninja|pkg-config|ldd|nm|objdump|readelf|strings|xxd|hexdump|od|base64|openssl|gpg|man|tldr|gh|docker|podman|systemctl|journalctl|hyprctl|busctl|loginctl|notify-send'

  ok=1; reason=""
  segs=$(printf '%s\n' "$cmd" | sed -E 's/(\|\||\|\||&&|\||;)/\n/g')
  while IFS= read -r seg; do
    [ -z "${seg// /}" ] && continue
    # редиректы: любые > или >> не в /dev/null — мутация
    nostd=$(printf '%s' "$seg" | sed -E 's/[0-9]?>>?[[:space:]]*\/dev\/null//g')
    case "$nostd" in
      *'>>'*|*'>'*)
        ok=0; reason="перенаправление '$(printf '%s' "$nostd" | grep -oE '[0-9]?>>?[^ ]*' | head -1)'"; break ;;
    esac
    first=$(printf '%s' "$seg" | awk '{$1=$1};1' | cut -d' ' -f1)
    case "$first" in
      "" ) continue ;;
      *$(printf '%s' "$READ_CMDS" | tr '|' '|')* )
        # точная проверка ниже case-ом (bash glob слишком широк)
        ;;
    esac
    case " $(echo "$READ_CMDS" | tr '|' ' ') " in
      *" $first "*)
        # git/sqlite3/python/sed — глубокие проверки
        case "$first" in
          git)
            gsub=$(printf '%s' "$seg" | awk '{print $2}')
            case " log diff show status blame branch tag remote rev-parse ls-files ls-remote describe shortlog grep cat-file config stash list worktree mergetool --version " in
              *" $gsub "*) : ;;
              " --version "*) : ;;
              *) ok=0; reason="git $gsub запрещён (read-only: log/diff/show/status/blame/...)" ; break ;;
            esac ;;
          sqlite3)
            printf '%s' "$seg" | grep -Eqi '\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|ATTACH|DETACH|REPLACE|VACUUM)\b' \
              && { ok=0; reason="sqlite3-мутация запрещена (только SELECT)"; break; } ;;
          python3|python)
            printf '%s' "$seg" | grep -Eq "open\([^)]*,[^)]*['\"][wax]" \
              && { ok=0; reason="python open(...,'w'/'a'/'x') запрещён (read-only)"; break; }
            printf '%s' "$seg" | grep -Eq "mode=['\"](w|a|x)" \
              && { ok=0; reason="python open(mode='w'/'a'/'x') запрещён (read-only)"; break; }
            printf '%s' "$seg" | grep -Eq '\b(shutil|os\.remove|os\.unlink|os\.rename|os\.mkdir|os\.makedirs|os\.rmdir|subprocess|Path\([^)]*\)\.write|\.write_text|\.write_bytes)\b' \
              && { ok=0; reason="python-мутации (shutil/os/subprocess/write_*) запрещены"; break; } ;;
          sed)
            printf '%s' "$seg" | grep -Eq '(^|[[:space:]])-i' \
              && { ok=0; reason="sed -i запрещён (read-only)"; break; } ;;
        esac ;;
      *)
        ok=0; reason="команда '$first' вне read-only whitelist"; break ;;
    esac
  done <<< "$segs"

  [ "$ok" -eq 0 ] && block "[PANTHEON] shell роли '$role': $reason. Policy: артефакты — через write в .pantheon/; остальное проси conductor."
fi

plog "debug" "guard.sh" "$session_id" "allowed" "tool=$tool role=$role"
exit 0
