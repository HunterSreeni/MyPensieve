#!/bin/bash
# Simulate a fresh user by using a temporary HOME directory.
# This tests the scaffold + wizard without touching your real ~/.mypensieve/
#
# Usage: ./scripts/test-fresh-user.sh
#   - Runs `mypensieve init` with a clean HOME
#   - After wizard completes, shows what was created
#   - Cleans up on exit

set -e

FAKE_HOME=$(mktemp -d /tmp/mypensieve-fresh-test-XXXXXX)
echo "[test] Using fake HOME: $FAKE_HOME"
echo "[test] Your real ~/.mypensieve is untouched."
echo ""

# Export fake HOME so all paths resolve there
export HOME="$FAKE_HOME"

# Ollama host stays the same (your real Ollama daemon)
export OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"

# Run the wizard
echo "[test] Running: mypensieve init"
echo "================================================"
node "$(dirname "$0")/../dist/cli/index.js" init

echo ""
echo "================================================"
echo "[test] Scaffold created. Contents:"
echo ""

if [ -d "$FAKE_HOME/.mypensieve" ]; then
    find "$FAKE_HOME/.mypensieve" -type f | sort | while read -r f; do
        perms=$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f" 2>/dev/null)
        echo "  [$perms] ${f#$FAKE_HOME/}"
    done
    echo ""
    echo "[test] Config:"
    cat "$FAKE_HOME/.mypensieve/config.json" 2>/dev/null | head -30
    echo ""
    echo "[test] Agent persona file:"
    cat "$FAKE_HOME/.mypensieve/persona/agent.md" 2>/dev/null
    echo ""
    echo "[test] Operator persona file:"
    cat "$FAKE_HOME/.mypensieve/persona/operator.md" 2>/dev/null
else
    echo "  (nothing created - wizard may have exited early)"
fi

echo ""
echo "================================================"
echo "[test] To explore manually:"
echo "  export HOME=$FAKE_HOME"
echo "  node dist/cli/index.js start"
echo ""
echo "[test] To clean up:"
echo "  rm -rf $FAKE_HOME"
