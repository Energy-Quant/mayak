#!/usr/bin/env bash
# github-setup-token.sh — add GITHUB_PERSONAL_ACCESS_TOKEN to goose secrets.yaml.
# Usage: ./scripts/github-setup-token.sh ghp_xxxxxxxx   (or pipe token via stdin)
# The token is stored in ~/.config/goose/secrets.yaml (used by goose env_keys).
set -euo pipefail
SECRETS="$HOME/.config/goose/secrets.yaml"
TOKEN="${1:-$(cat)}"
[ -n "$TOKEN" ] || { echo "No token provided"; exit 1; }
mkdir -p "$(dirname "$SECRETS")"; touch "$SECRETS"; chmod 600 "$SECRETS"
if grep -q '^GITHUB_PERSONAL_ACCESS_TOKEN:' "$SECRETS"; then
  sed -i "s|^GITHUB_PERSONAL_ACCESS_TOKEN:.*|GITHUB_PERSONAL_ACCESS_TOKEN: $TOKEN|" "$SECRETS"
else
  printf 'GITHUB_PERSONAL_ACCESS_TOKEN: %s\n' "$TOKEN" >> "$SECRETS"
fi
echo "Token saved to $SECRETS (chmod 600). Restart goose to load github-mcp-server."
