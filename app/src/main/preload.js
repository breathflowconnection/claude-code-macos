// With nodeIntegration enabled, the renderer can use require() directly.
// This preload exposes the IPC bridge as window.claude for clean separation.
const { ipcRenderer } = require("electron");

window.claude = {
  // PTY communication
  pty: {
    spawn: (projectDir) => ipcRenderer.send("pty-spawn", projectDir),
    write: (data) => ipcRenderer.send("pty-input", data),
    resize: (cols, rows) => ipcRenderer.send("pty-resize", { cols, rows }),
    kill: () => ipcRenderer.send("pty-kill"),
    onData: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("pty-data", listener);
      return () => ipcRenderer.removeListener("pty-data", listener);
    },
    onExit: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("pty-exit", listener);
      return () => ipcRenderer.removeListener("pty-exit", listener);
    },
    onError: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("pty-error", listener);
      return () => ipcRenderer.removeListener("pty-error", listener);
    },
  },

  // Settings
  settings: {
    get: () => ipcRenderer.invoke("get-settings"),
    set: (settings) => ipcRenderer.invoke("set-settings", settings),
  },

  // Utilities
  getClaudePath: () => ipcRenderer.invoke("get-claude-path"),
  selectDirectory: () => ipcRenderer.invoke("select-directory"),

  // Menu events
  on: (channel, callback) => {
    const validChannels = [
      "new-session",
      "clear-terminal",
      "open-project",
      "open-settings",
      "zoom-in",
      "zoom-out",
      "zoom-reset",
      "theme-changed",
    ];
    if (validChannels.includes(channel)) {
      const listener = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
  },
};
