const { app, BrowserWindow, ipcMain, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let typerProcess = null;
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const stopFlagPath = path.join(app.getPath('userData'), 'stop.flag');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 650,
    height: 700,
    resizable: true,
    minWidth: 500,
    minHeight: 600,
    title: "Auto Typer",
    backgroundColor: "#1a1a2e",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('renderer.html');

  // Open external links in user's default browser instead of Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    cleanup();
  });
}

// Clean up child process and flags
function cleanup() {
  stopTyping();
}

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function stopTyping(options = {}) {
  const { notify = true } = options;

  // 1. Set the file flag to stop the PowerShell loop immediately
  try {
    fs.writeFileSync(stopFlagPath, 'stop', 'utf8');
  } catch (err) {
    console.error("Failed to write stop flag:", err);
  }

  // 2. Kill the process as a secondary fail-safe
  if (typerProcess) {
    try {
      typerProcess.kill('SIGTERM');
    } catch (e) {
      console.error("Failed to kill typer process:", e);
    }
    typerProcess = null;
  }

  if (notify) {
    sendToRenderer('typing-stopped', 'Stopped');
  }
}

// Register global hotkeys
function registerHotkeys() {
  let startShortcut = 'F6';
  let stopShortcut = 'CommandOrControl+Alt+S';

  // Load custom shortcuts from settings if they exist
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(data);
      if (settings.startShortcut) startShortcut = settings.startShortcut;
      if (settings.stopShortcut) stopShortcut = settings.stopShortcut;
    }
  } catch (e) {
    console.error("Failed to load custom hotkeys on startup:", e);
  }

  try {
    const registeredStart = globalShortcut.register(startShortcut, () => {
      sendToRenderer('hotkey-start');
    });

    const registeredStop = globalShortcut.register(stopShortcut, () => {
      stopTyping();
    });

    if (!registeredStart || !registeredStop) {
      console.error("Hotkey registration failed:", { startShortcut, registeredStart, stopShortcut, registeredStop });
    }
  } catch (err) {
    console.error("Hotkey registration failed:", err);
  }
}

function unregisterHotkeys() {
  globalShortcut.unregisterAll();
}

app.whenReady().then(() => {
  createWindow();
  registerHotkeys();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  cleanup();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  unregisterHotkeys();
  cleanup();
});

// IPC Handler - Load Settings
ipcMain.handle('load-settings', () => {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Failed to load settings file:", e);
  }
  return null;
});

// IPC Handler - Save Settings
ipcMain.handle('save-settings', (event, settings) => {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error("Failed to save settings file:", e);
    return false;
  }
});

// IPC Handler - Read Clipboard
ipcMain.handle('read-clipboard', () => {
  return clipboard.readText();
});

// IPC Handler - Update Custom Hotkeys
ipcMain.handle('update-hotkeys', (event, { startShortcut, stopShortcut }) => {
  globalShortcut.unregisterAll();
  
  let registeredStart = false;
  let registeredStop = false;

  try {
    registeredStart = globalShortcut.register(startShortcut, () => {
      sendToRenderer('hotkey-start');
    });
  } catch (e) {
    console.error("Failed to register custom start shortcut:", startShortcut, e);
  }

  try {
    registeredStop = globalShortcut.register(stopShortcut, () => {
      stopTyping();
    });
  } catch (e) {
    console.error("Failed to register custom stop shortcut:", stopShortcut, e);
  }

  if (!registeredStart || !registeredStop) {
    // Attempt fallback registration to ensure shortcuts are available
    globalShortcut.unregisterAll();
    
    try {
      globalShortcut.register('F6', () => {
        sendToRenderer('hotkey-start');
      });
      globalShortcut.register('CommandOrControl+Alt+S', () => {
        stopTyping();
      });
    } catch (fallbackErr) {
      console.error("Fallback hotkey registration failed:", fallbackErr);
    }
    
    return { 
      success: false, 
      error: `Could not register custom shortcuts. Reverted to defaults: Start [F6], Stop [Ctrl+Alt+S].` 
    };
  }

  return { success: true };
});

// IPC Handler - Start Typing Process
ipcMain.on('start-typing', (event, args) => {
  // Ensure any existing process is stopped and old flag deleted
  stopTyping({ notify: false });
  try {
    if (fs.existsSync(stopFlagPath)) {
      fs.unlinkSync(stopFlagPath);
    }
  } catch (e) {
    console.error("Failed to clean old stop flag:", e);
  }

  const { text, delayMs, jitterMs, typeMode } = args;

  const scriptPath = path.join(__dirname, 'typer.ps1');

  // Spawn powershell to execute the typing script
  typerProcess = spawn('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-Text', text,
    '-DelayMs', delayMs,
    '-JitterMs', jitterMs,
    '-TypeMode', typeMode,
    '-StopFlagPath', stopFlagPath,
    '-ParentPid', process.pid
  ]);
  const currentProcess = typerProcess;

  sendToRenderer('typing-started');

  // Buffer outputs
  currentProcess.stdout.on('data', (data) => {
    const lines = data.toString().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    lines.forEach((output) => {
      if (!output) return;

      // Parse specific events from PowerShell
      if (output.startsWith('TARGET_LOCKED:')) {
        const title = output.replace('TARGET_LOCKED:', '').trim();
        sendToRenderer('status-update', { state: 'typing', message: `Locked to: ${title}` });
      } else if (output.startsWith('STATUS:')) {
        const status = output.replace('STATUS:', '').trim();
        sendToRenderer('status-update', { state: 'idle', message: status });
        cleanupProcessRef(currentProcess);
      } else if (output.startsWith('ERROR:')) {
        const err = output.replace('ERROR:', '').trim();
        sendToRenderer('status-update', { state: 'error', message: err });
        cleanupProcessRef(currentProcess);
      } else if (output.startsWith('DIAGNOSTIC_ERROR:')) {
        let err = output.replace('DIAGNOSTIC_ERROR:', '').trim();
        if (err.includes("Win32 Error: 5")) {
          err = "Access Denied (Error 5). Target app is running as Admin. Please run AutoTyper as Admin.";
        }
        sendToRenderer('status-update', { state: 'error', message: err });
        cleanupProcessRef(currentProcess);
      } else {
        // General logs
        console.log(`PowerShell stdout: ${output}`);
      }
    });
  });

  currentProcess.stderr.on('data', (data) => {
    const errorMsg = data.toString().trim();
    console.error(`PowerShell stderr: ${errorMsg}`);
    sendToRenderer('status-update', { state: 'error', message: `Engine error: ${errorMsg}` });
    cleanupProcessRef(currentProcess);
  });

  currentProcess.on('error', (err) => {
    console.error("Failed to start PowerShell typing process:", err);
    sendToRenderer('status-update', { state: 'error', message: `Could not start typing engine: ${err.message}` });
    cleanupProcessRef(currentProcess);
  });

  currentProcess.on('close', (code) => {
    console.log(`PowerShell process exited with code ${code}`);
    cleanupProcessRef(currentProcess);
  });
});

// IPC Handler - Stop Typing Command
ipcMain.on('stop-typing', () => {
  stopTyping();
});

function cleanupProcessRef(processRef) {
  if (!processRef || typerProcess === processRef) {
    typerProcess = null;
  }
}
