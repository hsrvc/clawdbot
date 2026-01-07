#!/bin/bash
# Quick model config editor with gateway restart
# Usage: ./scripts/models.sh [edit|restart|show]

CONFIG="$HOME/.clawdbot/clawdbot.json"
PORT=18789

wait_for_port() {
  local port=$1
  for i in {1..10}; do
    if ! lsof -i :$port > /dev/null; then
      return 0
    fi
    echo "Waiting for port $port to clear... ($i/10)"
    sleep 1
  done
  return 1
}

restart_gateway() {
  echo "Restarting gateway..."
  
  # Try graceful kill first
  pkill -f "bun.*gateway --port $PORT" 2>/dev/null
  
  if ! wait_for_port $PORT; then
    echo "Port $PORT still in use. Forcing cleanup..."
    lsof -ti :$PORT | xargs kill -9 2>/dev/null
    sleep 1
  fi

  cd "$(dirname "$0")/.." && ~/.bun/bin/bun run clawdbot gateway --port $PORT &
  
  # Verify start
  sleep 2
  if lsof -i :$PORT > /dev/null; then
    echo "Gateway restarted successfully on port $PORT."
  else
    echo "Gateway failed to start. Check logs."
    return 1
  fi
}

case "${1:-show}" in
  edit)
    ${EDITOR:-nano} "$CONFIG"
    echo "Config saved."
    restart_gateway
    ;;
  restart)
    restart_gateway
    ;;
  show)
    echo "=== Model Priority ==="
    echo "Primary: $(jq -r '.agent.model.primary' "$CONFIG")"
    echo ""
    echo "Fallbacks:"
    jq -r '.agent.model.fallbacks[]' "$CONFIG" | nl
    echo ""
    echo "Aliases:"
    jq -r '.agent.models | to_entries[] | "\(.value.alias) = \(.key)"' "$CONFIG"
    ;;
  *)
    echo "Usage: $0 [edit|restart|show]"
    echo "  show    - Display current model priority (default)"
    echo "  edit    - Edit config and restart gateway"
    echo "  restart - Just restart gateway"
    ;;
esac
