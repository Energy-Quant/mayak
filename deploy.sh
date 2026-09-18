#!/usr/bin/env bash
# deploy.sh — установка Phase 0 + Phase 1 Пантеона одной командой
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p ~/.agents/agents ~/.config/goose/recipes ~/.agents/plugins ~/.local/share/goose
cp "$ROOT"/agents/*.md ~/.agents/agents/
cp "$ROOT"/recipes/*.yaml ~/.config/goose/recipes/
rm -rf ~/.agents/plugins/pantheon && cp -r "$ROOT"/plugin ~/.agents/plugins/pantheon
sqlite3 ~/.local/share/goose/pantheon.db < "$ROOT"/sql/schema.sql && echo "pantheon.db ok"
# GOOSE_SUBAGENT_MAX_TURNS
if [ -f ~/.config/environment.d/90-goose-subagent.conf ]; then
  echo "env уже настроен: $(cat ~/.config/environment.d/90-goose-subagent.conf)"
else
  mkdir -p ~/.config/environment.d
  echo "GOOSE_SUBAGENT_MAX_TURNS=1000" > ~/.config/environment.d/90-goose-subagent.conf
fi
echo "Готово. В config.yaml проверь: extensions.orchestrator.enabled=true и extensions.pantheon-state."
