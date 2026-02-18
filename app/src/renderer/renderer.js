// ── xterm.js imports ─────────────────────────────────────────────────
const { Terminal } = require("@xterm/xterm");
const { FitAddon } = require("@xterm/addon-fit");
const { WebLinksAddon } = require("@xterm/addon-web-links");
const { Unicode11Addon } = require("@xterm/addon-unicode11");

// ── State ────────────────────────────────────────────────────────────
let terminal = null;
let fitAddon = null;
let currentFontSize = 14;
let isTerminalActive = false;

// ── DOM refs ─────────────────────────────────────────────────────────
const welcomeScreen = document.getElementById("welcome-screen");
const terminalContainer = document.getElementById("terminal-container");
const terminalEl = document.getElementById("terminal");
const claudeStatus = document.getElementById("claude-status");
const settingsOverlay = document.getElementById("settings-overlay");

// Buttons
const btnStart = document.getElementById("btn-start");
const btnStartProject = document.getElementById("btn-start-project");
const btnNewSession = document.getElementById("btn-new-session");
const btnOpenProject = document.getElementById("btn-open-project");
const btnSettings = document.getElementById("btn-settings");
const btnCloseSettings = document.getElementById("btn-close-settings");
const btnSaveSettings = document.getElementById("btn-save-settings");
const btnDetectClaude = document.getElementById("btn-detect-claude");

// ── Initialize ───────────────────────────────────────────────────────
async function init() {
  await applyTheme();
  await checkClaude();
  setupEventListeners();
  setupMenuListeners();
}

// ── Theme ────────────────────────────────────────────────────────────
async function applyTheme() {
  const settings = await window.claude.settings.get();
  document.documentElement.setAttribute("data-theme", settings.theme);
}

// ── Check claude binary ──────────────────────────────────────────────
async function checkClaude() {
  const claudePath = await window.claude.getClaudePath();
  if (claudePath) {
    claudeStatus.textContent = `Claude found: ${claudePath}`;
    claudeStatus.className = "found";
    btnStart.disabled = false;
  } else {
    claudeStatus.innerHTML =
      'Claude Code not found. Install: <code>curl -fsSL https://claude.ai/install.sh | bash</code>';
    claudeStatus.className = "not-found";
    btnStart.disabled = true;
  }
}

// ── Terminal setup ───────────────────────────────────────────────────
async function createTerminal() {
  const settings = await window.claude.settings.get();
  currentFontSize = settings.fontSize;

  terminal = new Terminal({
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: 10000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    theme: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      cursorAccent: "#1e1e2e",
      selectionBackground: "rgba(217, 119, 6, 0.3)",
      selectionForeground: "#cdd6f4",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f38ba8",
      brightGreen: "#a6e3a1",
      brightYellow: "#f9e2af",
      brightBlue: "#89b4fa",
      brightMagenta: "#f5c2e7",
      brightCyan: "#94e2d5",
      brightWhite: "#a6adc8",
    },
  });

  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = "11";

  terminal.open(terminalEl);
  fitAddon.fit();

  // Forward terminal input to PTY
  terminal.onData((data) => {
    window.claude.pty.write(data);
  });

  // Handle resize
  terminal.onResize(({ cols, rows }) => {
    window.claude.pty.resize(cols, rows);
  });

  // Listen for PTY output
  window.claude.pty.onData((data) => {
    terminal.write(data);
  });

  // Listen for PTY exit
  window.claude.pty.onExit(({ exitCode }) => {
    terminal.writeln("");
    terminal.writeln(
      `\x1b[33m── Claude Code exited (code: ${exitCode}) ──\x1b[0m`
    );
    terminal.writeln(
      "\x1b[90mPress any key to restart, or \u2318N for new session\x1b[0m"
    );
    isTerminalActive = false;

    // Restart on keypress
    const disposable = terminal.onKey(() => {
      disposable.dispose();
      startClaude();
    });
  });

  // Listen for PTY errors
  window.claude.pty.onError((message) => {
    terminal.writeln(`\x1b[31mError: ${message}\x1b[0m`);
  });

  // Fit on window resize
  const resizeObserver = new ResizeObserver(() => {
    if (fitAddon && isTerminalActive) {
      fitAddon.fit();
    }
  });
  resizeObserver.observe(terminalContainer);
}

// ── Start claude ─────────────────────────────────────────────────────
function startClaude(projectDir) {
  if (!terminal) return;

  isTerminalActive = true;
  terminal.clear();
  terminal.focus();

  // Resize before spawning
  if (fitAddon) {
    fitAddon.fit();
  }

  window.claude.pty.spawn(projectDir || null);
}

// ── Show terminal ────────────────────────────────────────────────────
async function showTerminal(projectDir) {
  welcomeScreen.classList.add("hidden");
  terminalContainer.classList.remove("hidden");

  if (!terminal) {
    await createTerminal();
  }

  startClaude(projectDir);
}

// ── Settings ─────────────────────────────────────────────────────────
async function openSettings() {
  const settings = await window.claude.settings.get();
  document.getElementById("setting-font-size").value = settings.fontSize;
  document.getElementById("setting-font-family").value = settings.fontFamily;
  document.getElementById("setting-theme").value = settings.theme;
  document.getElementById("setting-claude-path").value =
    settings.claudePath || "";
  document.getElementById("setting-start-in-tray").checked =
    settings.startInTray;
  document.getElementById("setting-global-shortcut").value =
    settings.globalShortcut || "";
  settingsOverlay.classList.remove("hidden");
}

async function saveSettings() {
  const settings = {
    fontSize: parseInt(
      document.getElementById("setting-font-size").value,
      10
    ),
    fontFamily: document.getElementById("setting-font-family").value,
    theme: document.getElementById("setting-theme").value,
    claudePath: document.getElementById("setting-claude-path").value,
    startInTray: document.getElementById("setting-start-in-tray").checked,
    globalShortcut: document.getElementById("setting-global-shortcut").value,
  };

  await window.claude.settings.set(settings);

  // Apply changes
  document.documentElement.setAttribute("data-theme", settings.theme);

  if (terminal) {
    terminal.options.fontSize = settings.fontSize;
    terminal.options.fontFamily = settings.fontFamily;
    currentFontSize = settings.fontSize;
    if (fitAddon) fitAddon.fit();
  }

  settingsOverlay.classList.add("hidden");
}

function closeSettings() {
  settingsOverlay.classList.add("hidden");
}

// ── Event listeners ──────────────────────────────────────────────────
function setupEventListeners() {
  btnStart.addEventListener("click", () => showTerminal());
  btnStartProject.addEventListener("click", async () => {
    const dir = await window.claude.selectDirectory();
    if (dir) showTerminal(dir);
  });
  btnNewSession.addEventListener("click", () => {
    window.claude.pty.kill();
    if (terminal) {
      terminal.clear();
      startClaude();
    } else {
      showTerminal();
    }
  });
  btnOpenProject.addEventListener("click", async () => {
    const dir = await window.claude.selectDirectory();
    if (dir) {
      window.claude.pty.kill();
      if (terminal) terminal.clear();
      showTerminal(dir);
    }
  });
  btnSettings.addEventListener("click", openSettings);
  btnCloseSettings.addEventListener("click", closeSettings);
  btnSaveSettings.addEventListener("click", saveSettings);
  btnDetectClaude.addEventListener("click", async () => {
    const foundPath = await window.claude.getClaudePath();
    document.getElementById("setting-claude-path").value = foundPath || "";
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !settingsOverlay.classList.contains("hidden")) {
      closeSettings();
    }
  });
}

// ── Menu event listeners ─────────────────────────────────────────────
function setupMenuListeners() {
  window.claude.on("new-session", () => {
    window.claude.pty.kill();
    if (terminal) {
      terminal.clear();
      startClaude();
    } else {
      showTerminal();
    }
  });

  window.claude.on("clear-terminal", () => {
    if (terminal) terminal.clear();
  });

  window.claude.on("open-project", (dir) => {
    window.claude.pty.kill();
    if (terminal) terminal.clear();
    showTerminal(dir);
  });

  window.claude.on("open-settings", openSettings);

  window.claude.on("zoom-in", () => {
    if (terminal) {
      currentFontSize = Math.min(currentFontSize + 2, 32);
      terminal.options.fontSize = currentFontSize;
      if (fitAddon) fitAddon.fit();
    }
  });

  window.claude.on("zoom-out", () => {
    if (terminal) {
      currentFontSize = Math.max(currentFontSize - 2, 10);
      terminal.options.fontSize = currentFontSize;
      if (fitAddon) fitAddon.fit();
    }
  });

  window.claude.on("zoom-reset", () => {
    if (terminal) {
      currentFontSize = 14;
      terminal.options.fontSize = currentFontSize;
      if (fitAddon) fitAddon.fit();
    }
  });

  window.claude.on("theme-changed", () => {
    // System theme changed - CSS handles it via prefers-color-scheme
  });
}

// ── Boot ──────────────────────────────────────────────────────────────
init();
