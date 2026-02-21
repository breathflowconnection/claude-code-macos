/* global Terminal, FitAddon, WebLinksAddon, Unicode11Addon */

// ── State ───────────────────────────────────────────────────
let token = localStorage.getItem("claude-token");
let ws = null;
let terminal = null;
let fitAddon = null;
let currentProject = null;

// ── DOM refs ────────────────────────────────────────────────
const loginScreen = document.getElementById("login-screen");
const projectScreen = document.getElementById("project-screen");
const terminalScreen = document.getElementById("terminal-screen");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const passwordInput = document.getElementById("password-input");
const projectList = document.getElementById("project-list");
const terminalContainer = document.getElementById("terminal-container");
const terminalTitle = document.getElementById("terminal-title");
const mobileInputForm = document.getElementById("mobile-input-form");
const mobileInput = document.getElementById("mobile-input");
const quickKeys = document.getElementById("quick-keys");

// ── Screen navigation ───────────────────────────────────────
function showScreen(screen) {
  loginScreen.classList.add("hidden");
  projectScreen.classList.add("hidden");
  terminalScreen.classList.add("hidden");
  screen.classList.remove("hidden");
}

// ── Login ───────────────────────────────────────────────────
loginForm.addEventListener("submit", async function(e) {
  e.preventDefault();
  loginError.classList.add("hidden");
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: passwordInput.value }),
    });
    if (res.ok) {
      const data = await res.json();
      token = data.token;
      localStorage.setItem("claude-token", token);
      loadProjects();
    } else {
      loginError.textContent = "Wrong password";
      loginError.classList.remove("hidden");
      passwordInput.value = "";
      passwordInput.focus();
    }
  } catch (err) {
    loginError.textContent = "Connection failed";
    loginError.classList.remove("hidden");
  }
});

// ── Logout ──────────────────────────────────────────────────
document.getElementById("btn-logout").addEventListener("click", function() {
  token = null;
  localStorage.removeItem("claude-token");
  disconnectTerminal();
  showScreen(loginScreen);
  passwordInput.value = "";
});

// ── Projects ────────────────────────────────────────────────
async function loadProjects() {
  try {
    const res = await fetch("/api/projects", {
      headers: { Authorization: "Bearer " + token },
    });
    if (res.status === 401) {
      token = null;
      localStorage.removeItem("claude-token");
      showScreen(loginScreen);
      return;
    }
    const { projects, claudeFound } = await res.json();
    projectList.innerHTML = "";
    if (!claudeFound) {
      projectList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--danger)">Claude Code not found</div>';
    }
    projects.forEach(function(proj) {
      const item = document.createElement("div");
      item.className = "project-item";
      item.innerHTML =
        '<div class="project-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16a2 2 0 002-2V8a2 2 0 00-2-2h-7.93a2 2 0 01-1.66-.9l-.82-1.2A2 2 0 007.93 3H4a2 2 0 00-2 2v13a2 2 0 002 2z"/></svg></div>' +
        '<div class="project-info"><div class="project-name">' + escapeHtml(proj.name) + '</div><div class="project-path">' + escapeHtml(proj.path) + '</div></div>' +
        '<div class="project-arrow"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,6 15,12 9,18"/></svg></div>';
      item.addEventListener("click", function() { openProject(proj.path, proj.name); });
      projectList.appendChild(item);
    });
    showScreen(projectScreen);
  } catch (err) {
    showScreen(loginScreen);
  }
}

// ── Home session ────────────────────────────────────────────
document.getElementById("btn-home-session").addEventListener("click", function() {
  openProject(null, "Home");
});

// ── Open project ────────────────────────────────────────────
function openProject(dir, name) {
  currentProject = dir;
  terminalTitle.textContent = name || "Session";
  showScreen(terminalScreen);
  connectTerminal(dir);
  setTimeout(function() { mobileInput.focus(); }, 500);
}

// ── Terminal ────────────────────────────────────────────────
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

function connectTerminal(projectDir) {
  disconnectTerminal();

  terminal = new Terminal({
    fontSize: 12,
    fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: 5000,
    allowProposedApi: true,
    theme: TERM_THEME,
  });

  fitAddon = new FitAddon.FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(new WebLinksAddon.WebLinksAddon());
  terminal.loadAddon(new Unicode11Addon.Unicode11Addon());
  terminal.unicode.activeVersion = "11";

  terminal.open(terminalContainer);
  requestAnimationFrame(function() { fitAddon.fit(); });

  // WebSocket
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ token: token });
  if (projectDir) params.set("dir", projectDir);

  ws = new WebSocket(protocol + "//" + location.host + "/?" + params);

  ws.onopen = function() {
    ws.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
  };

  ws.onmessage = function(event) {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "data") {
        terminal.write(msg.data);
      } else if (msg.type === "exit") {
        terminal.writeln("");
        terminal.writeln("\x1b[33m── Session ended ──\x1b[0m");
      } else if (msg.type === "error") {
        terminal.writeln("\x1b[31mError: " + msg.data + "\x1b[0m");
      }
    } catch (e) {}
  };

  ws.onclose = function() {
    if (terminal) {
      terminal.writeln("");
      terminal.writeln("\x1b[90m── Connection closed ──\x1b[0m");
    }
  };

  // Forward xterm keyboard input directly (for hardware keyboards or direct typing)
  terminal.onData(function(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data: data }));
    }
  });

  terminal.onResize(function(size) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols: size.cols, rows: size.rows }));
    }
  });

  var observer = new ResizeObserver(function() {
    if (fitAddon && terminal) {
      try { fitAddon.fit(); } catch (e) {}
    }
  });
  observer.observe(terminalContainer);
  terminal._resizeObserver = observer;
}

function sendRaw(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "input", data: data }));
  }
}

function submitPrompt(text) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    // Use "submit" type: server writes chars one by one then sends Enter
    ws.send(JSON.stringify({ type: "submit", data: text }));
  }
}

function disconnectTerminal() {
  if (ws) { ws.close(); ws = null; }
  if (terminal) {
    if (terminal._resizeObserver) terminal._resizeObserver.disconnect();
    terminal.dispose();
    terminal = null;
    fitAddon = null;
    terminalContainer.innerHTML = "";
  }
}

// ── Back button ─────────────────────────────────────────────
document.getElementById("btn-back").addEventListener("click", function() {
  disconnectTerminal();
  loadProjects();
});

// ── Quick keys ──────────────────────────────────────────────
quickKeys.addEventListener("click", function(e) {
  var btn = e.target.closest("button");
  if (!btn) return;
  var key = btn.dataset.key;
  if (key) sendRaw(key);
  mobileInput.focus();
});

// ── Mobile input bar (primary input) ────────────────────────
mobileInputForm.addEventListener("submit", function(e) {
  e.preventDefault();
  var text = mobileInput.value;
  if (text) {
    submitPrompt(text);
    mobileInput.value = "";
  }
  mobileInput.focus();
});

// ── Paste button ────────────────────────────────────────────
document.getElementById("btn-paste").addEventListener("click", async function() {
  try {
    var text = await navigator.clipboard.readText();
    if (text) sendRaw(text);
  } catch (e) {
    var text2 = prompt("Paste text:");
    if (text2) sendRaw(text2);
  }
  mobileInput.focus();
});

// ── Viewport resize (mobile keyboard) ───────────────────────
function adjustLayout() {
  if (!fitAddon || !terminal) return;
  try { fitAddon.fit(); } catch (e) {}
}

window.addEventListener("resize", function() {
  setTimeout(adjustLayout, 100);
});

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", function() {
    var vh = window.visualViewport.height;
    document.getElementById("terminal-screen").style.height = vh + "px";
    setTimeout(adjustLayout, 50);
  });
  window.visualViewport.addEventListener("scroll", function() {
    window.scrollTo(0, 0);
  });
}

// ── Util ────────────────────────────────────────────────────
function escapeHtml(str) {
  var div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Init ────────────────────────────────────────────────────
if (token) {
  loadProjects();
} else {
  showScreen(loginScreen);
}
