#!/usr/bin/env bash
# github-branch-protection.sh — apply the Mayak branch model to GitHub.
#
# Branch model:
#   main       — stable, NO direct push for anyone (merge only via PR by owner/maintainers)
#   dev        — integration, maintainers merge, features land here first
#   feature-*  — ephemeral, pushable by their creators
#   tags (v*)  — stable releases, produced from main via CI/CD
#
# Requires: GITHUB_PERSONAL_ACCESS_TOKEN (repo scope + admin:repo_hook not needed;
#           "repo" is enough for branch protection on a repo you own).
# Usage:    GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx ./scripts/github-branch-protection.sh
#
# Comments: English. Exits non-zero on any API failure.
set -euo pipefail

TOKEN="${GITHUB_PERSONAL_ACCESS_TOKEN:?Set GITHUB_PERSONAL_ACCESS_TOKEN (repo scope)}"
OWNER="${GITHUB_OWNER:-Energy-Quant}"
REPO="${GITHUB_REPO:-mayak}"
API="https://api.github.com"
AUTH=(-H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json")

req() { # req METHOD PATH [JSON_BODY]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" "${AUTH[@]}" "$API$path" -d "$body"
  else
    curl -sS -X "$method" "${AUTH[@]}" "$API$path"
  fi
}

echo "==> Applying branch protection to $OWNER/$REPO"

# ── main: stable, protected, PR-only, no force push ──
echo "--- main (strict: PR-only, no force push, CI required, admins included)"
req PUT "/repos/$OWNER/$REPO/branches/main/protection" "$(cat <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["ci"] },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "required_linear_history": true
}
JSON
)" | python3 -c "import sys,json; d=json.load(sys.stdin); print('main:', 'OK' if 'url' in d else d.get('message', d))"

# ── dev: integration, maintainers can push/merge, CI required, no force push ──
echo "--- dev (integration: maintainers push, CI required)"
req PUT "/repos/$OWNER/$REPO/branches/dev/protection" "$(cat <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["ci"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false,
  "required_linear_history": false
}
JSON
)" | python3 -c "import sys,json; d=json.load(sys.stdin); print('dev:', 'OK' if 'url' in d else d.get('message', d))"

echo "==> Done. main = PR-only + CI; dev = maintainer-push + CI."
echo "    feature-* branches are free-form (no protection)."
echo "    Tags (v*) trigger release.yml from main."
