#!/bin/bash
# Checks if clawdbot gateway (port 18789) is running.
# If not, restarts it using models.sh.

PORT=18789
# Resolving absolute path to script directory
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
MODELS_SCRIPT="$DIR/models.sh"

# Ensure timestamp in log
echo "[$(date)] Checking clawdbot status..."

if lsof -i :$PORT > /dev/null; then
  echo "[$(date)] Status: ONLINE (Port $PORT active)."
  exit 0
else
  echo "[$(date)] Status: OFFLINE (Port $PORT closed). Initiating restart..."
  "$MODELS_SCRIPT" restart
  echo "[$(date)] Restart command executed."
fi
