#!/bin/bash
# Launch Claude Code macOS in development mode
# Unsets ELECTRON_RUN_AS_NODE which VSCode sets in its terminal
cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE
node_modules/.bin/electron .
