const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");
const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "3131", 10);
const PASSWORD = process.env.CLAUDE_PASSWORD || crypto.randomBytes(4).toString("hex");
const PROJECTS_DIR = process.env.PROJECTS_DIR || path.join(os.homedir(), "Desktop", "Github");

const validTokens = new Set();

function createToken() {
  const token = crypto.randomBytes(32).toString("hex");
  validTokens.add(token);
  return token;
}

function findClaudeBinary() {
  var candidates = [
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    "/opt/homebrew/bin/claude",
    path.join(os.homedir(), ".npm-global/bin/claude"),
    path.join(os.homedir(), ".local/bin/claude"),
    path.join(os.homedir(), ".claude/local/claude"),
  ];
  for (var i = 0; i < candidates.length; i++) {
    try { fs.accessSync(candidates[i], fs.constants.X_OK); return candidates[i]; } catch (e) {}
  }
  try {
    return require("child_process").execSync("which claude", { encoding: "utf8", timeout: 5000 }).trim();
  } catch (e) {}
  return null;
}

function listProjects() {
  try {
    return fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter(function(e) { return e.isDirectory() && e.name[0] !== "."; })
      .map(function(e) { return { name: e.name, path: path.join(PROJECTS_DIR, e.name) }; })
      .sort(function(a, b) { return a.name.localeCompare(b.name); });
  } catch (err) {
    return [];
  }
}

var app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use("/xterm", express.static(path.join(__dirname, "node_modules", "@xterm")));

function requireAuth(req, res, next) {
  var token = (req.headers.authorization || "").replace("Bearer ", "") || req.query.token;
  if (!token || !validTokens.has(token)) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.post("/api/login", function(req, res) {
  if (req.body.password === PASSWORD) {
    res.json({ token: createToken() });
  } else {
    res.status(401).json({ error: "Wrong password" });
  }
});

app.get("/api/projects", requireAuth, function(_req, res) {
  res.json({ projects: listProjects(), claudeFound: !!findClaudeBinary() });
});

app.use(express.static(path.join(__dirname, "public")));
app.get("*", function(_req, res) {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

var server = http.createServer(app);
var wss = new WebSocketServer({ server });
var ptyMap = new Map();

// Write text to PTY character by character with delays
// This is needed because Claude Code's ink TUI processes input
// character by character in raw mode
function writeSlowly(proc, text, callback) {
  var i = 0;
  function next() {
    if (i >= text.length) {
      if (callback) callback();
      return;
    }
    proc.write(text[i]);
    i++;
    // Small delay between characters so ink can process each one
    setTimeout(next, 5);
  }
  next();
}

wss.on("connection", function(ws, req) {
  var url = new URL(req.url, "http://" + req.headers.host);
  var token = url.searchParams.get("token");

  if (!token || !validTokens.has(token)) {
    console.log("[WS] Unauthorized");
    ws.close(4001, "Unauthorized");
    return;
  }

  var projectDir = url.searchParams.get("dir") || os.homedir();
  var claudeBinary = findClaudeBinary();

  console.log("[WS] Connected. Project: " + projectDir + ", Claude: " + claudeBinary);

  if (!claudeBinary) {
    ws.send(JSON.stringify({ type: "error", data: "Claude Code not found" }));
    ws.close();
    return;
  }

  var env = Object.assign({}, process.env, {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: process.env.LANG || "en_US.UTF-8",
    HOME: process.env.HOME || "/root",
    NODE_OPTIONS: "--max-old-space-size=4096",
  });
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SESSION;
  delete env.CLAUDE_CODE_ENTRY_POINT;
  delete env.ELECTRON_RUN_AS_NODE;

  var proc = pty.spawn(claudeBinary, [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: projectDir,
    env: env,
  });

  console.log("[PTY] Spawned pid " + proc.pid + " in " + projectDir);
  ptyMap.set(ws, proc);

  proc.onData(function(data) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "data", data: data }));
    }
  });

  proc.onExit(function(info) {
    console.log("[PTY] Exited with code " + info.exitCode);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", exitCode: info.exitCode }));
    }
  });

  ws.on("message", function(raw) {
    try {
      var msg = JSON.parse(raw);
      if (msg.type === "input") {
        console.log("[INPUT] " + JSON.stringify(msg.data).substring(0, 80));
        // Write directly - single chars or control sequences
        proc.write(msg.data);
      } else if (msg.type === "submit") {
        // Mobile input: write text char by char, then Enter after a delay
        console.log("[SUBMIT] " + JSON.stringify(msg.data).substring(0, 80));
        writeSlowly(proc, msg.data, function() {
          // Send Enter after all characters are written
          setTimeout(function() {
            proc.write("\r");
          }, 30);
        });
      } else if (msg.type === "resize") {
        console.log("[RESIZE] " + msg.cols + "x" + msg.rows);
        proc.resize(msg.cols, msg.rows);
      }
    } catch (e) {
      console.log("[WS] Parse error: " + e.message);
    }
  });

  ws.on("close", function() {
    console.log("[WS] Disconnected");
    try { proc.kill(); } catch (e) {}
    ptyMap.delete(ws);
  });
});

server.listen(PORT, "0.0.0.0", function() {
  var localIP = "0.0.0.0";
  var interfaces = os.networkInterfaces();
  for (var name in interfaces) {
    for (var i = 0; i < interfaces[name].length; i++) {
      var addr = interfaces[name][i];
      if (addr.family === "IPv4" && !addr.internal) { localIP = addr.address; break; }
    }
    if (localIP !== "0.0.0.0") break;
  }
  console.log("");
  console.log("  Claude Code Mobile Server");
  console.log("  Local:    http://localhost:" + PORT);
  console.log("  Network:  http://" + localIP + ":" + PORT);
  console.log("  Password: " + PASSWORD);
  console.log("  Projects: " + PROJECTS_DIR);
  console.log("  Claude:   " + (findClaudeBinary() || "NOT FOUND"));
  console.log("");
});

process.on("SIGINT", function() {
  ptyMap.forEach(function(proc) { try { proc.kill(); } catch(e) {} });
  process.exit(0);
});
