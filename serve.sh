#!/bin/bash
# SightLine Mobile — one-command serve for iPhone install
# Usage: bash serve.sh [port]
set -e
cd "$(dirname "$0")"
PORT="${1:-8080}"

# Get LAN IP for the QR/phone instructions
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null \
     || hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR-LAN-IP")

echo "╔═══════════════════════════════════════════════╗"
echo "║  SightLine Mobile — serving on port $PORT    ║"
echo "║                                               ║"
echo "║  On this computer:  http://localhost:$PORT    ║"
echo "║  On your iPhone:    http://$IP:$PORT          ║"
echo "║                                               ║"
echo "║  1. Open the iPhone URL in Safari             ║"
echo "║  2. Share → Add to Home Screen                ║"
echo "║  3. Wait for ENGINE: READY badge (~40MB)      ║"
echo "║  4. Turn on airplane mode — app still works   ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""
python3 -m http.server "$PORT" --bind 0.0.0.0
