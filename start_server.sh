#!/usr/bin/env bash

set -e

# Directory containing this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default port
PORT="${1:-8000}"

echo "Starting ENG-654 presentation server..."
echo "Directory: $SCRIPT_DIR"
echo "URL: http://localhost:$PORT"
echo ""
echo "Press Ctrl+C to stop the server."

cd "$SCRIPT_DIR"

python3 -m http.server "$PORT"