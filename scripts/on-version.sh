#!/usr/bin/env bash
# on-version.sh - npm "version" lifecycle hook
# Runs AFTER package.json is bumped but BEFORE the version commit.
# Keeps KNOWN-LIMITATIONS.md and CHANGELOG.md in sync with the new version.
set -euo pipefail

VERSION=$(node -e "console.log(require('./package.json').version)")
TODAY=$(date +%F)

# --- 1. Patch KNOWN-LIMITATIONS.md header ---
LIMITS="docs/KNOWN-LIMITATIONS.md"
if [ -f "$LIMITS" ]; then
  sed -i "s|^> Last updated:.*|> Last updated: ${TODAY} (v${VERSION})|" "$LIMITS"
  git add "$LIMITS"
  echo "[on-version] Updated $LIMITS -> v${VERSION} (${TODAY})"
else
  echo "[on-version] WARNING: $LIMITS not found, skipping"
fi

# --- 2. Validate CHANGELOG.md has an entry for this version ---
CHANGELOG="CHANGELOG.md"
if [ -f "$CHANGELOG" ]; then
  if grep -q "## \[${VERSION}\]" "$CHANGELOG"; then
    echo "[on-version] CHANGELOG.md has entry for v${VERSION} - good"
  else
    echo ""
    echo "ERROR: CHANGELOG.md has no entry for [${VERSION}]."
    echo "Add a ## [${VERSION}] section before running npm version."
    echo ""
    exit 1
  fi
else
  echo "[on-version] WARNING: $CHANGELOG not found, skipping"
fi
