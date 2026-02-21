#!/bin/bash
# Launch Claude Code Mobile Server
# Access from your phone at the URL shown after startup

cd "$(dirname "$0")"

# Unset env vars that conflict with Claude Code
unset ELECTRON_RUN_AS_NODE
unset CLAUDECODE
unset CLAUDE_CODE_SESSION
unset CLAUDE_CODE_ENTRY_POINT

# Set a fixed password (change this to your own!)
export CLAUDE_PASSWORD="claude2024"

# Optional: set port (default 3131)
# export PORT=3131

node server.js
