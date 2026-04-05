#!/bin/bash
# Build a debug DMG with remote shell baked in.
#
# Usage:
#   Terminal 1:  node scripts/debug-server.js
#   Terminal 2:  ./scripts/make-debug.sh [x64|arm64]
#
# The tester just opens the app — you get a shell.

set -e

ARCH="${1:-x64}"
PORT=9999

echo "[make-debug] Starting ngrok HTTP tunnel on port $PORT..."
ngrok http $PORT --log=stdout --log-level=warn > /tmp/ngrok-debug.log 2>&1 &
NGROK_PID=$!
trap "kill $NGROK_PID 2>/dev/null" EXIT

sleep 3

# Get the public URL from ngrok API
NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | python3 -c "
import sys, json
tunnels = json.load(sys.stdin)['tunnels']
for t in tunnels:
    if 'https' in t['public_url']:
        addr = t['public_url'].replace('https://', '')
        print(f'wss://{addr}')
        break
" 2>/dev/null)

if [ -z "$NGROK_URL" ]; then
  echo "ERROR: Could not get ngrok URL. Make sure ngrok is authenticated:"
  echo "  ngrok config add-authtoken <your-token>"
  echo "  (Get a free token at https://dashboard.ngrok.com)"
  exit 1
fi

echo "[make-debug] ngrok URL: $NGROK_URL"
echo "[make-debug] Building debug DMG for $ARCH..."

SMC_DEBUG_URL="$NGROK_URL" npx electron-forge make --arch="$ARCH"

echo ""
echo "========================================="
echo "  DEBUG BUILD READY"
echo "  DMG: out/make/SteamMacClient-1.0.0-${ARCH}.dmg"
echo "  ngrok: $NGROK_URL"
echo "========================================="
echo ""
echo "Keep this terminal open (ngrok is running)."
echo "Make sure debug-server.js is running in another terminal."
echo "Send the DMG — tester just opens it, you get a shell."
echo ""
echo "Press Ctrl+C to stop."

# Keep alive
wait $NGROK_PID 2>/dev/null
