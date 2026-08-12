#!/usr/bin/env bash
set -Eeuo pipefail

assert_render_release_sha() {
  : "${RENDER_GIT_COMMIT:?RENDER_GIT_COMMIT is required on Render}"

  if [[ ! "$RENDER_GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
    printf 'Invalid RENDER_GIT_COMMIT: expected a full 40-hex commit SHA.\n' >&2
    return 1
  fi

  if [[ -n "${RELEASE_SHA:-}" && "$RELEASE_SHA" != "$RENDER_GIT_COMMIT" ]]; then
    printf 'Refusing deploy: RELEASE_SHA=%s does not match RENDER_GIT_COMMIT=%s\n' \
      "$RELEASE_SHA" "$RENDER_GIT_COMMIT" >&2
    return 1
  fi

  if git rev-parse HEAD >/dev/null 2>&1; then
    local checkout_sha
    checkout_sha="$(git rev-parse HEAD)"
    if [[ "$checkout_sha" != "$RENDER_GIT_COMMIT" ]]; then
      printf 'Refusing deploy: checkout=%s does not match Render commit=%s\n' \
        "$checkout_sha" "$RENDER_GIT_COMMIT" >&2
      return 1
    fi
  fi

  export RELEASE_SHA="$RENDER_GIT_COMMIT"
}

configure_render_dashboard_env() {
  local dashboard_origin="${RENDER_DASHBOARD_ORIGIN:-${RENDER_EXTERNAL_URL:-}}"
  local facilitator_origin="${AGENTPAY_FACILITATOR_ORIGIN:-}"

  if [[ -n "$dashboard_origin" ]]; then
    dashboard_origin="${dashboard_origin%/}"
    export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-$dashboard_origin}"
  fi

  if [[ -n "$facilitator_origin" ]]; then
    facilitator_origin="${facilitator_origin%/}"
    export FACILITATOR_URL="${FACILITATOR_URL:-$facilitator_origin/hedera}"
    export ARC_FACILITATOR_URL="${ARC_FACILITATOR_URL:-$facilitator_origin/arc}"
    export CARDANO_PREPROD_FACILITATOR_URL="${CARDANO_PREPROD_FACILITATOR_URL:-$facilitator_origin/cardano}"
  fi

  if [[ "${APP_ENV:-}" == "production" ]]; then
    for url_name in NEXT_PUBLIC_APP_URL FACILITATOR_URL ARC_FACILITATOR_URL CARDANO_PREPROD_FACILITATOR_URL; do
      local url_value="${!url_name:-}"
      if [[ -n "$url_value" && "$url_value" != https://* ]]; then
        printf '%s must use HTTPS in production.\n' "$url_name" >&2
        return 1
      fi
    done
  fi
}
