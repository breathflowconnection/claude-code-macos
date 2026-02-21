const { Terminal } = require("@xterm/xterm");
const { FitAddon } = require("@xterm/addon-fit");
const { WebLinksAddon } = require("@xterm/addon-web-links");
const { Unicode11Addon } = require("@xterm/addon-unicode11");

// ── Tab state ────────────────────────────────────────────────────────
let tabCounter = 0;
let activeTabId = null;
const tabs = new Map(); // tabId → { terminal, fitAddon, el, label, projectDir, active }
let currentFontSize = 14;

// ── DOM refs ─────────────────────────────────────────────────────────
const welcomeScreen = document.getElementById("welcome-screen");
const terminalsContainer = document.getElementById("terminals-container");
const tabsEl = document.getElementById("tabs");
const claudeStatus = document.getElementById("claude-status");
const settingsOverlay = document.getElementById("settings-overlay");

// ── Init ─────────────────────────────────────────────────────────────
async function init() {
  await applyTheme();
  await checkClaude();
  setupEventListeners();
  setupMenuListeners();
  setupPtyListeners();
}

async function applyTheme() {
  const settings = await window.claude.settings.get();
  document.documentElement.setAttribute("data-theme", settings.theme);
}

async function checkClaude() {
  const claudePath = await window.claude.getClaudePath();
  if (claudePath) {
    claudeStatus.textContent = `Claude found: ${claudePath}`;
    claudeStatus.className = "found";
    document.getElementById("btn-start").disabled = false;
  } else {
    claudeStatus.innerHTML =
      'Claude Code not found. Install: <code>curl -fsSL https://claude.ai/install.sh | bash</code>';
    claudeStatus.className = "not-found";
    document.getElementById("btn-start").disabled = true;
  }
}

// ── Terminal theme ───────────────────────────────────────────────────
const TERM_THEME = {
  background: "#1e1e2e",
  foreground: "#cdd6f4",
  cursor: "#f5e0dc",
  cursorAccent: "#1e1e2e",
  selectionBackground: "rgba(217, 119, 6, 0.3)",
  selectionForeground: "#cdd6f4",
  black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af",
  blue: "#89b4fa", magenta: "#f5c2e7", cyan: "#94e2d5", white: "#bac2de",
  brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1",
  brightYellow: "#f9e2af", brightBlue: "#89b4fa", brightMagenta: "#f5c2e7",
  brightCyan: "#94e2d5", brightWhite: "#a6adc8",
};

// ── Tab management ───────────────────────────────────────────────────
async function createTab(projectDir) {
  const tabId = `tab-${++tabCounter}`;
  const settings = await window.claude.settings.get();
  currentFontSize = settings.fontSize;

  // Hide welcome, show terminals
  welcomeScreen.classList.add("hidden");
  terminalsContainer.classList.remove("hidden");

  // Create terminal DOM element
  const termEl = document.createElement("div");
  termEl.className = "terminal-panel";
  termEl.id = `terminal-${tabId}`;
  terminalsContainer.appendChild(termEl);

  // Create xterm instance
  const terminal = new Terminal({
    fontSize: settings.fontSize,
    fontFamily: settings.fontFamily,
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: 10000,
    allowProposedApi: true,
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    theme: TERM_THEME,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon());
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = "11";

  terminal.open(termEl);

  // Forward input to this tab's PTY
  terminal.onData((data) => window.claude.pty.write(tabId, data));
  terminal.onResize(({ cols, rows }) => window.claude.pty.resize(tabId, cols, rows));

  // Determine label
  let label = "Session";
  if (projectDir) {
    const parts = projectDir.split("/");
    label = parts[parts.length - 1] || "Session";
  }

  // Store tab state
  tabs.set(tabId, { terminal, fitAddon, el: termEl, label, projectDir, active: true });

  // Create tab button
  renderTabBar();
  switchToTab(tabId);

  // Spawn PTY
  window.claude.pty.spawn(tabId, projectDir || null);

  return tabId;
}

function switchToTab(tabId) {
  if (!tabs.has(tabId)) return;

  activeTabId = tabId;

  // Hide all terminal panels, show the active one
  for (const [id, tab] of tabs) {
    tab.el.style.display = id === tabId ? "block" : "none";
  }

  // Update tab bar active state
  const tabButtons = tabsEl.querySelectorAll(".tab");
  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tabId === tabId);
  });

  // Focus and fit the terminal
  const tab = tabs.get(tabId);
  requestAnimationFrame(() => {
    tab.fitAddon.fit();
    tab.terminal.focus();
  });
}

function closeTab(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  // Kill PTY
  window.claude.pty.kill(tabId);

  // Dispose terminal
  tab.terminal.dispose();
  tab.el.remove();
  tabs.delete(tabId);

  // If no tabs left, show welcome screen
  if (tabs.size === 0) {
    activeTabId = null;
    terminalsContainer.classList.add("hidden");
    welcomeScreen.classList.remove("hidden");
    renderTabBar();
    return;
  }

  // Switch to another tab
  if (activeTabId === tabId) {
    const remaining = [...tabs.keys()];
    switchToTab(remaining[remaining.length - 1]);
  }

  renderTabBar();
}

function nextTab() {
  const ids = [...tabs.keys()];
  if (ids.length < 2) return;
  const idx = ids.indexOf(activeTabId);
  switchToTab(ids[(idx + 1) % ids.length]);
}

function prevTab() {
  const ids = [...tabs.keys()];
  if (ids.length < 2) return;
  const idx = ids.indexOf(activeTabId);
  switchToTab(ids[(idx - 1 + ids.length) % ids.length]);
}

function renderTabBar() {
  tabsEl.innerHTML = "";
  for (const [tabId, tab] of tabs) {
    const btn = document.createElement("div");
    btn.className = "tab" + (tabId === activeTabId ? " active" : "");
    btn.dataset.tabId = tabId;

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tab.label;
    btn.appendChild(label);

    const close = document.createElement("span");
    close.className = "tab-close";
    close.textContent = "\u00d7";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(tabId);
    });
    btn.appendChild(close);

    btn.addEventListener("click", () => switchToTab(tabId));
    tabsEl.appendChild(btn);
  }
}

// ── PTY event listeners ──────────────────────────────────────────────
function setupPtyListeners() {
  window.claude.pty.onData((tabId, data) => {
    const tab = tabs.get(tabId);
    if (tab) tab.terminal.write(data);
  });

  window.claude.pty.onExit((tabId, exitCode) => {
    const tab = tabs.get(tabId);
    if (!tab) return;
    tab.active = false;
    tab.terminal.writeln("");
    tab.terminal.writeln(`\x1b[33m\u2500\u2500 Claude Code exited (code: ${exitCode}) \u2500\u2500\x1b[0m`);
    tab.terminal.writeln("\x1b[90mPress any key to restart, or \u2318T for new tab\x1b[0m");
    const disposable = tab.terminal.onKey(() => {
      disposable.dispose();
      tab.active = true;
      tab.terminal.clear();
      tab.fitAddon.fit();
      window.claude.pty.spawn(tabId, tab.projectDir || null);
    });
  });

  window.claude.pty.onError((tabId, message) => {
    const tab = tabs.get(tabId);
    if (tab) tab.terminal.writeln(`\x1b[31mError: ${message}\x1b[0m`);
  });
}

// ── Resize observer ──────────────────────────────────────────────────
const resizeObserver = new ResizeObserver(() => {
  if (activeTabId) {
    const tab = tabs.get(activeTabId);
    if (tab && tab.active) tab.fitAddon.fit();
  }
});
resizeObserver.observe(terminalsContainer);

// ── Settings ─────────────────────────────────────────────────────────
async function openSettings() {
  const s = await window.claude.settings.get();
  document.getElementById("setting-font-size").value = s.fontSize;
  document.getElementById("setting-font-family").value = s.fontFamily;
  document.getElementById("setting-theme").value = s.theme;
  document.getElementById("setting-claude-path").value = s.claudePath || "";
  document.getElementById("setting-start-in-tray").checked = s.startInTray;
  document.getElementById("setting-global-shortcut").value = s.globalShortcut || "";
  settingsOverlay.classList.remove("hidden");
}

async function saveSettings() {
  const settings = {
    fontSize: parseInt(document.getElementById("setting-font-size").value, 10),
    fontFamily: document.getElementById("setting-font-family").value,
    theme: document.getElementById("setting-theme").value,
    claudePath: document.getElementById("setting-claude-path").value,
    startInTray: document.getElementById("setting-start-in-tray").checked,
    globalShortcut: document.getElementById("setting-global-shortcut").value,
  };
  await window.claude.settings.set(settings);
  document.documentElement.setAttribute("data-theme", settings.theme);
  currentFontSize = settings.fontSize;
  for (const [, tab] of tabs) {
    tab.terminal.options.fontSize = settings.fontSize;
    tab.terminal.options.fontFamily = settings.fontFamily;
    tab.fitAddon.fit();
  }
  settingsOverlay.classList.add("hidden");
}

// ── Event listeners ──────────────────────────────────────────────────
function setupEventListeners() {
  document.getElementById("btn-start").addEventListener("click", () => createTab());
  document.getElementById("btn-start-project").addEventListener("click", async () => {
    const dir = await window.claude.selectDirectory();
    if (dir) createTab(dir);
  });
  document.getElementById("btn-new-tab").addEventListener("click", () => createTab());
  document.getElementById("btn-open-project").addEventListener("click", async () => {
    const dir = await window.claude.selectDirectory();
    if (dir) createTab(dir);
  });
  document.getElementById("btn-settings").addEventListener("click", openSettings);
  document.getElementById("btn-close-settings").addEventListener("click", () => settingsOverlay.classList.add("hidden"));
  document.getElementById("btn-save-settings").addEventListener("click", saveSettings);
  document.getElementById("btn-detect-claude").addEventListener("click", async () => {
    document.getElementById("setting-claude-path").value = (await window.claude.getClaudePath()) || "";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !settingsOverlay.classList.contains("hidden")) settingsOverlay.classList.add("hidden");
  });
}

// ── Menu event listeners ─────────────────────────────────────────────
function setupMenuListeners() {
  window.claude.on("new-tab", () => createTab());
  window.claude.on("close-tab", () => { if (activeTabId) closeTab(activeTabId); });
  window.claude.on("next-tab", nextTab);
  window.claude.on("prev-tab", prevTab);
  window.claude.on("new-session", () => createTab());

  window.claude.on("clear-terminal", () => {
    if (activeTabId) { const t = tabs.get(activeTabId); if (t) t.terminal.clear(); }
  });

  window.claude.on("open-project", (dir) => createTab(dir));
  window.claude.on("open-settings", openSettings);

  window.claude.on("zoom-in", () => {
    currentFontSize = Math.min(currentFontSize + 2, 32);
    for (const [, t] of tabs) { t.terminal.options.fontSize = currentFontSize; t.fitAddon.fit(); }
  });
  window.claude.on("zoom-out", () => {
    currentFontSize = Math.max(currentFontSize - 2, 10);
    for (const [, t] of tabs) { t.terminal.options.fontSize = currentFontSize; t.fitAddon.fit(); }
  });
  window.claude.on("zoom-reset", () => {
    currentFontSize = 14;
    for (const [, t] of tabs) { t.terminal.options.fontSize = currentFontSize; t.fitAddon.fit(); }
  });

  window.claude.on("theme-changed", () => {});
}

init();
