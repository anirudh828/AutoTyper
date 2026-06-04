const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  updateHotkeys: (shortcuts) => ipcRenderer.invoke('update-hotkeys', shortcuts),
  startTyping: (args) => ipcRenderer.send('start-typing', args),
  stopTyping: () => ipcRenderer.send('stop-typing'),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  
  onStatusUpdate: (callback) => ipcRenderer.on('status-update', (event, data) => callback(data)),
  onTypingStarted: (callback) => ipcRenderer.on('typing-started', () => callback()),
  onTypingStopped: (callback) => ipcRenderer.on('typing-stopped', (event, reason) => callback(reason)),
  onHotkeyStart: (callback) => ipcRenderer.on('hotkey-start', () => callback()),
  onCharTyped: (callback) => ipcRenderer.on('char-typed', () => callback())
});
