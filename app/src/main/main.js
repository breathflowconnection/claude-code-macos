const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  nativeTheme,
  ipcMain,
  dialog,
  shell,
  nativeImage,
} = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");
const pty = require("node-pty");

// ── Simple JSON settings store ──────────────────────────────────────
const DEFAULTS = {
  windowBounds: { width: 900, height: 700 },
  fontSize: 14,
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  theme: "system",
  shell: process.env.SHELL || "/bin/zsh",
  claudePath: "",
  startInTray: false,
  globalShortcut: "CommandOrControl+Shift+C",
};

class SimpleStore {
  constructor() {
    this._path = path.join(
      app.getPath("userData") || path.join(os.homedir(), ".claude-code-macos"),
      "settings.json"
    );
    this._data = { ...DEFAULTS };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this._path)) {
        const raw = fs.readFileSync(this._path, "utf8");
        this._data = { ...DEFAULTS, ...JSON.parse(raw) };
      }
    } catch {}
  }

  _save() {
    try {
      const dir = path.dirname(this._path);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._path, JSON.stringify(this._data, null, 2));
    } catch {}
  }

  get(key) {
    return key ? this._data[key] : { ...this._data };
  }

  set(key, value) {
    if (typeof key === "object") {
      Object.assign(this._data, key);
    } else {
      this._data[key] = value;
    }
    this._save();
  }
}

let store; // initialized after app is ready

let mainWindow = null;
let tray = null;
let ptyProcess = null;
let claudeBinaryPath = null;

// ── Find claude binary ──────────────────────────────────────────────
function findClaudeBinary() {
  const custom = store.get("claudePath");
  if (custom) return custom;

  const candidates = [
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
    path.join(os.homedir(), ".npm-global/bin/claude"),
    path.join(os.homedir(), ".local/bin/claude"),
    path.join(os.homedir(), ".claude/local/claude"),
  ];

  for (const p of candidates) {
    try {
      require("fs").accessSync(p, require("fs").constants.X_OK);
      return p;
    } catch {}
  }

  // Fallback: try which
  try {
    const result = require("child_process").execSync("which claude", {
      encoding: "utf8",
      timeout: 5000,
    });
    return result.trim();
  } catch {}

  return null;
}

// ── Create main window ──────────────────────────────────────────────
function createWindow() {
  const { width, height } = store.get("windowBounds");

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 15, y: 15 },
    vibrancy: "under-window",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
    },
    show: false,
    icon: getAppIcon(),
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on("resize", () => {
    const bounds = mainWindow.getBounds();
    store.set("windowBounds", { width: bounds.width, height: bounds.height });
  });

  mainWindow.on("close", (e) => {
    if (store.get("startInTray") && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    killPty();
  });
}

// ── App icon ────────────────────────────────────────────────────────
function getAppIcon() {
  const iconPath = path.join(__dirname, "..", "..", "assets", "icon.png");
  try {
    return nativeImage.createFromPath(iconPath);
  } catch {
    return null;
  }
}

// ── System tray ─────────────────────────────────────────────────────
function createTray() {
  const trayIcon = getAppIcon();
  if (!trayIcon) return;

  const smallIcon = trayIcon.resize({ width: 18, height: 18 });
  tray = new Tray(smallIcon);
  tray.setToolTip("Claude Code");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show Claude Code",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: "separator" },
    {
      label: "New Session",
      accelerator: "CommandOrControl+N",
      click: () => sendToRenderer("new-session"),
    },
    { type: "separator" },
    {
      label: "Quit",
      accelerator: "CommandOrControl+Q",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on("click", () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

// ── Application menu ────────────────────────────────────────────────
function createMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Preferences...",
          accelerator: "CommandOrControl+,",
          click: () => sendToRenderer("open-settings"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        {
          label: "Quit",
          accelerator: "CommandOrControl+Q",
          click: () => {
            app.isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: "Session",
      submenu: [
        {
          label: "New Session",
          accelerator: "CommandOrControl+N",
          click: () => sendToRenderer("new-session"),
        },
        {
          label: "Clear Terminal",
          accelerator: "CommandOrControl+K",
          click: () => sendToRenderer("clear-terminal"),
        },
        { type: "separator" },
        {
          label: "Open Project...",
          accelerator: "CommandOrControl+O",
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ["openDirectory"],
              message: "Select a project directory for Claude Code",
            });
            if (!result.canceled && result.filePaths.length > 0) {
              sendToRenderer("open-project", result.filePaths[0]);
            }
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Zoom In",
          accelerator: "CommandOrControl+=",
          click: () => sendToRenderer("zoom-in"),
        },
        {
          label: "Zoom Out",
          accelerator: "CommandOrControl+-",
          click: () => sendToRenderer("zoom-out"),
        },
        {
          label: "Reset Zoom",
          accelerator: "CommandOrControl+0",
          click: () => sendToRenderer("zoom-reset"),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Claude Code Documentation",
          click: () =>
            shell.openExternal("https://code.claude.com/docs/en/overview"),
        },
        {
          label: "Report Issue",
          click: () =>
            shell.openExternal(
              "https://github.com/breathflowconnection/claude-code-macos/issues"
            ),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── PTY management ──────────────────────────────────────────────────
function spawnPty(projectDir) {
  killPty();

  claudeBinaryPath = findClaudeBinary();

  if (!claudeBinaryPath) {
    sendToRenderer(
      "pty-error",
      "Claude Code binary not found. Install it with: curl -fsSL https://claude.ai/install.sh | bash"
    );
    return;
  }

  const shellPath = store.get("shell");
  const env = Object.assign({}, process.env, {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG || "en_US.UTF-8",
    NODE_OPTIONS: "--max-old-space-size=4096",
  });

  const cwd = projectDir || os.homedir();
  const args = [];

  ptyProcess = pty.spawn(claudeBinaryPath, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 40,
    cwd,
    env,
  });

  ptyProcess.onData((data) => {
    sendToRenderer("pty-data", data);
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    sendToRenderer("pty-exit", { exitCode, signal });
    ptyProcess = null;
  });
}

function killPty() {
  if (ptyProcess) {
    try {
      ptyProcess.kill();
    } catch {}
    ptyProcess = null;
  }
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ── IPC handlers ────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.on("pty-input", (_event, data) => {
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  ipcMain.on("pty-resize", (_event, { cols, rows }) => {
    if (ptyProcess) {
      try {
        ptyProcess.resize(cols, rows);
      } catch {}
    }
  });

  ipcMain.on("pty-spawn", (_event, projectDir) => {
    spawnPty(projectDir);
  });

  ipcMain.on("pty-kill", () => {
    killPty();
  });

  ipcMain.handle("get-settings", () => {
    return {
      fontSize: store.get("fontSize"),
      fontFamily: store.get("fontFamily"),
      theme: store.get("theme"),
      claudePath: store.get("claudePath"),
      startInTray: store.get("startInTray"),
      globalShortcut: store.get("globalShortcut"),
    };
  });

  ipcMain.handle("set-settings", (_event, settings) => {
    for (const [key, value] of Object.entries(settings)) {
      store.set(key, value);
    }
    return true;
  });

  ipcMain.handle("get-claude-path", () => {
    return findClaudeBinary();
  });

  ipcMain.handle("select-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });
}

// ── Global shortcuts ────────────────────────────────────────────────
function registerGlobalShortcut() {
  const shortcut = store.get("globalShortcut");
  if (shortcut) {
    globalShortcut.register(shortcut, () => {
      if (mainWindow) {
        if (mainWindow.isVisible() && mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      } else {
        createWindow();
      }
    });
  }
}

// ── App lifecycle ───────────────────────────────────────────────────
app.whenReady().then(() => {
  store = new SimpleStore();
  createMenu();
  createWindow();
  createTray();
  setupIPC();
  registerGlobalShortcut();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || !store.get("startInTray")) {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  killPty();
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

// Handle dark mode changes
nativeTheme.on("updated", () => {
  sendToRenderer("theme-changed", nativeTheme.shouldUseDarkColors);
});
