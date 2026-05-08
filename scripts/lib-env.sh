#!/usr/bin/env bash

aiws_repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}

aiws_load_env() {
  local repo_root="${1:-$(aiws_repo_root)}"
  local env_file="${AIWS_ENV_FILE:-$repo_root/.env}"
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
  fi
}
