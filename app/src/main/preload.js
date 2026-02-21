const { ipcRenderer } = require("electron");

window.claude = {
  pty: {
    spawn: (tabId, projectDir) => ipcRenderer.send("pty-spawn", { tabId, projectDir }),
    write: (tabId, data) => ipcRenderer.send("pty-input", { tabId, data }),
    resize: (tabId, cols, rows) => ipcRenderer.send("pty-resize", { tabId, cols, rows }),
    kill: (tabId) => ipcRenderer.send("pty-kill", tabId),
    onData: (callback) => {
      const listener = (_e, { tabId, data }) => callback(tabId, data);
      ipcRenderer.on("pty-data", listener);
      return () => ipcRenderer.removeListener("pty-data", listener);
    },
    onExit: (callback) => {
      const listener = (_e, { tabId, exitCode, signal }) => callback(tabId, exitCode, signal);
      ipcRenderer.on("pty-exit", listener);
      return () => ipcRenderer.removeListener("pty-exit", listener);
    },
    onError: (callback) => {
      const listener = (_e, { tabId, message }) => callback(tabId, message);
      ipcRenderer.on("pty-error", listener);
      return () => ipcRenderer.removeListener("pty-error", listener);
    },
  },
  settings: {
    get: () => ipcRenderer.invoke("get-settings"),
    set: (settings) => ipcRenderer.invoke("set-settings", settings),
  },
  getClaudePath: () => ipcRenderer.invoke("get-claude-path"),
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  on: (channel, callback) => {
    const valid = [
      "new-tab", "close-tab", "next-tab", "prev-tab",
      "new-session", "clear-terminal", "open-project", "open-settings",
      "zoom-in", "zoom-out", "zoom-reset", "theme-changed",
    ];
    if (valid.includes(channel)) {
      const listener = (_e, ...args) => callback(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
  },
};
