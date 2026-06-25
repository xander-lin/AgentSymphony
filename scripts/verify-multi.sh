#!/usr/bin/env bash
# Multi-machine verification script for AgentSymphony hub.
# Run this on each machine after configuring hubUrl in config.json.

set -euo pipefail

HUB_URL=$(python3 -c "
import json, os
path = os.path.expanduser('~/.config/opencode/agentsymphony/config.json')
try:
  cfg = json.load(open(path))
  print(cfg.get('hubUrl', 'http://127.0.0.1:4777'))
except:
  print('http://127.0.0.1:4777')
")

echo "=== AgentSymphony Multi-Machine Verification ==="
echo "Hub URL: $HUB_URL"
echo ""

# Check hub is reachable
echo "1. Checking hub reachability..."
if curl -sf "$HUB_URL/instances" > /dev/null 2>&1; then
  echo "   ✅ Hub is reachable"
else
  echo "   ❌ Cannot reach hub at $HUB_URL"
  echo "   Make sure the hub daemon is running and firewall allows connectivity."
  exit 1
fi

# Check config file
CONFIG="$HOME/.config/opencode/agentsymphony/config.json"
if [ -f "$CONFIG" ]; then
  echo "   ✅ Config file exists at $CONFIG"
else
  echo "   ❌ Config file not found. Create it with:"
  echo "   echo '{\"hubUrl\": \"$HUB_URL\"}' > $CONFIG"
  exit 1
fi

# Show current instances on hub
echo ""
echo "2. Current instances registered on hub:"
INSTANCES=$(curl -sf "$HUB_URL/instances" | python3 -c "
import json, sys
data = json.load(sys.stdin)
if not data:
    print('   (none connected)')
else:
    for i in data:
        online = 'online' if i.get('online', True) else 'offline'
        print(f'   • {i[\"name\"]} ({online})')
" 2>/dev/null || echo "   (unable to parse)")
echo "$INSTANCES"

echo ""
echo "=== Verification complete ==="
echo "Open $HUB_URL in a browser to view the dashboard."
