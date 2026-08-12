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
