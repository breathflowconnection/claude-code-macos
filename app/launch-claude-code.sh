#!/bin/bash
# Launcher for Claude Code macOS
# Unsets ELECTRON_RUN_AS_NODE (set by VSCode) and sources user PATH
export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"
unset ELECTRON_RUN_AS_NODE
unset CLAUDECODE
unset CLAUDE_CODE_SESSION
unset CLAUDE_CODE_ENTRY_POINT

APP_DIR="$(dirname "$0")"
ELECTRON="$APP_DIR/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

exec "$ELECTRON" "$APP_DIR"
