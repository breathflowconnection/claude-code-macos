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

let store;
let mainWindow = null;
let tray = null;

// ── Multi-tab PTY management ────────────────────────────────────────
const ptyProcesses = new Map();

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
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  try {
    return require("child_process")
      .execSync("which claude", { encoding: "utf8", timeout: 5000 })
      .trim();
  } catch {}
  return null;
}

function spawnPtyForTab(tabId, projectDir) {
  killPtyForTab(tabId);
  const claudeBinaryPath = findClaudeBinary();
  if (!claudeBinaryPath) {
    sendToRenderer("pty-error", {
      tabId,
      message: "Claude Code not found. Install: curl -fsSL https://claude.ai/install.sh | bash",
    });
    return;
  }
  const env = Object.assign({}, process.env, {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG || "en_US.UTF-8",
    NODE_OPTIONS: "--max-old-space-size=4096",
  });
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SESSION;
  delete env.CLAUDE_CODE_ENTRY_POINT;
  delete env.ELECTRON_RUN_AS_NODE;

  const proc = pty.spawn(claudeBinaryPath, [], {
    name: "xterm-256color",
    cols: 120,
    rows: 40,
    cwd: projectDir || os.homedir(),
    env,
  });
  ptyProcesses.set(tabId, proc);

  proc.onData((data) => sendToRenderer("pty-data", { tabId, data }));
  proc.onExit(({ exitCode, signal }) => {
    sendToRenderer("pty-exit", { tabId, exitCode, signal });
    ptyProcesses.delete(tabId);
  });
}

function killPtyForTab(tabId) {
  const proc = ptyProcesses.get(tabId);
  if (proc) {
    try { proc.kill(); } catch {}
    ptyProcesses.delete(tabId);
  }
}

function killAllPty() {
  for (const [, proc] of ptyProcesses) {
    try { proc.kill(); } catch {}
  }
  ptyProcesses.clear();
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ── Window ──────────────────────────────────────────────────────────
function createWindow() {
  const { width, height } = store.get("windowBounds");
  mainWindow = new BrowserWindow({
    width, height,
    minWidth: 600, minHeight: 400,
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
  mainWindow.once("ready-to-show", () => { mainWindow.show(); mainWindow.focus(); });
  mainWindow.on("resize", () => {
    const b = mainWindow.getBounds();
    store.set("windowBounds", { width: b.width, height: b.height });
  });
  mainWindow.on("close", (e) => {
    if (store.get("startInTray") && !app.isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
  mainWindow.on("closed", () => { mainWindow = null; killAllPty(); });
}

function getAppIcon() {
  try { return nativeImage.createFromPath(path.join(__dirname, "..", "..", "assets", "icon.png")); }
  catch { return null; }
}

// ── System tray ─────────────────────────────────────────────────────
function createTray() {
  const trayIcon = getAppIcon();
  if (!trayIcon) return;
  tray = new Tray(trayIcon.resize({ width: 18, height: 18 }));
  tray.setToolTip("Claude Code");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show Claude Code", click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } else createWindow(); } },
    { type: "separator" },
    { label: "New Tab", accelerator: "CommandOrControl+T", click: () => sendToRenderer("new-tab") },
    { type: "separator" },
    { label: "Quit", accelerator: "CommandOrControl+Q", click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on("click", () => { if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show(); });
}

// ── Menu ────────────────────────────────────────────────────────────
function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: "about" },
      { type: "separator" },
      { label: "Preferences...", accelerator: "CommandOrControl+,", click: () => sendToRenderer("open-settings") },
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" }, { role: "hideOthers" }, { role: "unhide" },
      { type: "separator" },
      { label: "Quit", accelerator: "CommandOrControl+Q", click: () => { app.isQuitting = true; app.quit(); } },
    ]},
    { label: "Session", submenu: [
      { label: "New Tab", accelerator: "CommandOrControl+T", click: () => sendToRenderer("new-tab") },
      { label: "Close Tab", accelerator: "CommandOrControl+W", click: () => sendToRenderer("close-tab") },
      { type: "separator" },
      { label: "Next Tab", accelerator: "Control+Tab", click: () => sendToRenderer("next-tab") },
      { label: "Previous Tab", accelerator: "Control+Shift+Tab", click: () => sendToRenderer("prev-tab") },
      { type: "separator" },
      { label: "Clear Terminal", accelerator: "CommandOrControl+K", click: () => sendToRenderer("clear-terminal") },
      { label: "Open Project in Tab...", accelerator: "CommandOrControl+O", click: async () => {
        const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"], message: "Select a project directory" });
        if (!result.canceled && result.filePaths.length > 0) sendToRenderer("open-project", result.filePaths[0]);
      }},
    ]},
    { label: "Edit", submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ]},
    { label: "View", submenu: [
      { label: "Zoom In", accelerator: "CommandOrControl+=", click: () => sendToRenderer("zoom-in") },
      { label: "Zoom Out", accelerator: "CommandOrControl+-", click: () => sendToRenderer("zoom-out") },
      { label: "Reset Zoom", accelerator: "CommandOrControl+0", click: () => sendToRenderer("zoom-reset") },
      { type: "separator" }, { role: "togglefullscreen" }, { type: "separator" }, { role: "toggleDevTools" },
    ]},
    { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, { type: "separator" }, { role: "front" }] },
    { label: "Help", submenu: [
      { label: "Claude Code Documentation", click: () => shell.openExternal("https://code.claude.com/docs/en/overview") },
      { label: "Report Issue", click: () => shell.openExternal("https://github.com/breathflowconnection/claude-code-macos/issues") },
    ]},
  ]));
}

// ── IPC ─────────────────────────────────────────────────────────────
function setupIPC() {
  ipcMain.on("pty-input", (_e, { tabId, data }) => {
    const proc = ptyProcesses.get(tabId);
    if (proc) proc.write(data);
  });
  ipcMain.on("pty-resize", (_e, { tabId, cols, rows }) => {
    const proc = ptyProcesses.get(tabId);
    if (proc) try { proc.resize(cols, rows); } catch {}
  });
  ipcMain.on("pty-spawn", (_e, { tabId, projectDir }) => spawnPtyForTab(tabId, projectDir));
  ipcMain.on("pty-kill", (_e, tabId) => killPtyForTab(tabId));

  ipcMain.handle("get-settings", () => ({
    fontSize: store.get("fontSize"),
    fontFamily: store.get("fontFamily"),
    theme: store.get("theme"),
    claudePath: store.get("claudePath"),
    startInTray: store.get("startInTray"),
    globalShortcut: store.get("globalShortcut"),
  }));
  ipcMain.handle("set-settings", (_e, settings) => {
    for (const [k, v] of Object.entries(settings)) store.set(k, v);
    return true;
  });
  ipcMain.handle("get-claude-path", () => findClaudeBinary());
  ipcMain.handle("select-directory", async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory"] });
    return (!result.canceled && result.filePaths.length > 0) ? result.filePaths[0] : null;
  });
}

// ── Global shortcuts ────────────────────────────────────────────────
function registerGlobalShortcut() {
  const shortcut = store.get("globalShortcut");
  if (shortcut) {
    globalShortcut.register(shortcut, () => {
      if (mainWindow) {
        (mainWindow.isVisible() && mainWindow.isFocused()) ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus());
      } else createWindow();
    });
  }
}

// ── App lifecycle ───────────────────────────────────────────────────
app.whenReady().then(() => {
  store = new SimpleStore();
  createMenu(); createWindow(); createTray(); setupIPC(); registerGlobalShortcut();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin" || !store.get("startInTray")) app.quit(); });
app.on("will-quit", () => { globalShortcut.unregisterAll(); killAllPty(); });
app.on("before-quit", () => { app.isQuitting = true; });
nativeTheme.on("updated", () => sendToRenderer("theme-changed", nativeTheme.shouldUseDarkColors));
