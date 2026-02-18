# Claude Code macOS

Native macOS application for [Claude Code](https://github.com/anthropics/claude-code) — Anthropic's agentic coding tool.

This fork wraps Claude Code's terminal-based CLI in a native macOS Electron app with a proper window, system tray, global shortcuts, and all the native features you'd expect from a macOS developer tool.

## Features

- **Native macOS window** with hidden title bar and traffic light controls
- **xterm.js terminal emulator** for full Claude Code compatibility (colors, Unicode, links)
- **System tray** integration — keep Claude running in the background
- **Global shortcut** (Cmd+Shift+C) to toggle the window from anywhere
- **Project picker** — open any directory as a Claude Code project
- **Zoom controls** — adjust terminal font size on the fly
- **Dark/Light theme** — follows macOS system appearance or set manually
- **Settings panel** — configure fonts, theme, Claude binary path, and more
- **macOS vibrancy** — native translucent background effect

## Prerequisites

- macOS 12+ (Monterey or later)
- [Claude Code CLI](https://code.claude.com/docs/en/setup) installed:
  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  ```

## Quick Start

```bash
# Clone the repo
git clone https://github.com/breathflowconnection/claude-code-macos.git
cd claude-code-macos/app

# Install dependencies
npm install

# Launch in development mode
./start.sh
# Or: unset ELECTRON_RUN_AS_NODE && npx electron .
```

> **Note:** If running from VSCode's integrated terminal, you must unset `ELECTRON_RUN_AS_NODE` first (the `start.sh` script handles this automatically).

## Build as .app

```bash
cd app

# Build DMG for distribution
npm run build:dmg

# Build ZIP
npm run build:zip

# Build both
npm run build
```

Built artifacts appear in `app/dist/`.

## Architecture

```
app/
├── src/
│   ├── main/
│   │   ├── main.js        # Electron main process (window, tray, PTY, IPC)
│   │   └── preload.js     # Bridge between main and renderer
│   └── renderer/
│       ├── index.html      # App UI
│       ├── styles.css      # Catppuccin-inspired theme
│       └── renderer.js     # xterm.js terminal + UI logic
├── assets/
│   ├── icon.svg            # App icon source
│   ├── icon.png            # App icon (1024x1024)
│   └── icon.icns           # macOS icon set
├── entitlements.mac.plist  # macOS entitlements for code signing
├── package.json            # Dependencies + electron-builder config
└── start.sh                # Development launcher
```

### How It Works

1. **Main process** (`main.js`) creates a native macOS window with hidden title bar and vibrancy
2. Uses **node-pty** to spawn a pseudo-terminal running the `claude` binary
3. **Renderer process** embeds **xterm.js** to display the terminal output in the window
4. IPC bridge connects the PTY ↔ xterm.js for bidirectional I/O
5. All Claude Code features work identically to the terminal version

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+Shift+C` | Toggle window (global) |
| `Cmd+N` | New session |
| `Cmd+O` | Open project directory |
| `Cmd+K` | Clear terminal |
| `Cmd+,` | Settings |
| `Cmd+=` / `Cmd+-` | Zoom in/out |
| `Cmd+0` | Reset zoom |
| `Cmd+Q` | Quit |

## Settings

Access via `Cmd+,` or the gear icon:

- **Font Size** — Terminal font size (10–32)
- **Font Family** — Monospace font for the terminal
- **Theme** — System / Dark / Light
- **Claude Binary Path** — Auto-detected or manual path
- **Start in Tray** — Keep running when window is closed
- **Global Shortcut** — Customize the toggle shortcut

## License

Based on [Claude Code](https://github.com/anthropics/claude-code) by Anthropic. See [LICENSE.md](LICENSE.md).
