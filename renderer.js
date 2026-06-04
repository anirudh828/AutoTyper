// Renderer process script for Safe AutoTyper

// State management
let state = {
  isArmed: false,
  isTyping: false,
  countdownVal: 0,
  delayMs: 50,
  jitterMs: 10,
  typeMode: 'character',
  countdownInterval: null,
  startShortcut: 'F6',
  stopShortcut: 'Ctrl+Alt+S',
  isRecordingHotkey: null,
  useClipboard: false,
  theme: 'default',
  soundEnabled: false,
  lastManualText: ''
};

// UI Elements
const textInput = document.getElementById('textInput');
const textCounter = document.getElementById('textCounter');
const modeToggle = document.getElementById('modeToggle');
const delaySlider = document.getElementById('delaySlider');
const delayVal = document.getElementById('delayVal');
const jitterSlider = document.getElementById('jitterSlider');
const jitterVal = document.getElementById('jitterVal');
const countdownSlider = document.getElementById('countdownSlider');
const countdownValEl = document.getElementById('countdownVal');
const startHotkeyBtn = document.getElementById('startHotkeyBtn');
const stopHotkeyBtn = document.getElementById('stopHotkeyBtn');
const clipboardToggle = document.getElementById('clipboardToggle');
const statusBadge = document.getElementById('statusBadge');
const safetyDisplay = document.getElementById('safetyDisplay');
const targetConfirmBox = document.getElementById('targetConfirmBox');
const targetText = document.getElementById('targetText');
const armBtn = document.getElementById('armBtn');
const stopBtn = document.getElementById('stopBtn');
const consoleBox = document.getElementById('consoleBox');

const countdownOverlay = document.getElementById('countdownOverlay');
const countdownNumber = document.getElementById('countdownNumber');
const countdownTarget = document.getElementById('countdownTarget');
const settingsBtn = document.getElementById('settingsBtn');
const homePanel = document.getElementById('homePanel');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const soundToggle = document.getElementById('soundToggle');
const resetDefaultsBtn = document.getElementById('resetDefaultsBtn');

// Helper: Console Log
function log(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  
  const timestamp = new Date().toLocaleTimeString();
  line.textContent = `[${timestamp}] ${msg}`;
  
  consoleBox.appendChild(line);
  consoleBox.scrollTop = consoleBox.scrollHeight;
  
  // Limit console buffer to 50 entries
  while (consoleBox.children.length > 50) {
    consoleBox.removeChild(consoleBox.firstChild);
  }
}

// Helper: Update Counters
function updateCounters() {
  const text = textInput.value;
  const chars = text.length;
  // Count lines (split by newline, filter out trailing blank if needed or just count split size)
  const lines = text ? text.split(/\r?\n/).length : 0;
  textCounter.textContent = `${chars} chars / ${lines} lines`;
}

// Load settings from disk
async function loadSavedSettings() {
  try {
    const saved = await window.api.loadSettings();
    if (saved) {
      if (saved.text !== undefined) {
        state.lastManualText = saved.text;
        textInput.value = saved.text;
      }
      if (saved.delayMs !== undefined) {
        state.delayMs = Math.max(30, saved.delayMs); // Enforce min 30ms limit
        delaySlider.value = state.delayMs;
        delayVal.textContent = `${state.delayMs} ms`;
      }
      if (saved.jitterMs !== undefined) {
        state.jitterMs = saved.jitterMs;
        jitterSlider.value = state.jitterMs;
        jitterVal.textContent = `${state.jitterMs} ms`;
      }
      if (saved.countdownVal !== undefined) {
        state.countdownVal = saved.countdownVal;
        countdownSlider.value = state.countdownVal;
        countdownValEl.textContent = state.countdownVal === 0 ? "Instant" : `${state.countdownVal} sec`;
      }
      if (saved.typeMode !== undefined) {
        state.typeMode = saved.typeMode;
        // Update toggle UI
        const buttons = modeToggle.querySelectorAll('.toggle-btn');
        buttons.forEach(btn => {
          if (btn.dataset.value === state.typeMode) {
            btn.classList.add('active');
          } else {
            btn.classList.remove('active');
          }
        });
      }
      if (saved.startShortcut !== undefined) {
        state.startShortcut = saved.startShortcut;
        startHotkeyBtn.textContent = state.startShortcut;
      }
      if (saved.stopShortcut !== undefined) {
        state.stopShortcut = saved.stopShortcut;
        stopHotkeyBtn.textContent = state.stopShortcut;
      }
      if (saved.useClipboard !== undefined) {
        state.useClipboard = saved.useClipboard;
        clipboardToggle.checked = state.useClipboard;
        toggleClipboardUI(state.useClipboard);
      }
      if (saved.theme !== undefined) {
        state.theme = saved.theme;
        applyTheme(state.theme);
      }
      if (saved.soundEnabled !== undefined) {
        state.soundEnabled = saved.soundEnabled;
        soundToggle.checked = state.soundEnabled;
      }
      log("Settings loaded from user storage.");
      if (!state.useClipboard) {
        updateCounters();
      }
      validateJitter();
    }
  } catch (err) {
    log(`Failed to load saved settings: ${err.message}`, 'warn');
  }
}

// Helper to load only saved text when disabling clipboard mode
async function loadSavedTextOnly() {
  try {
    const saved = await window.api.loadSettings();
    if (saved && saved.text !== undefined) {
      textInput.value = saved.text;
    }
  } catch (e) {}
}

// Clipboard UI Sync helper
function toggleClipboardUI(enabled) {
  if (enabled) {
    textInput.disabled = true;
    textInput.placeholder = "[Clipboard Mode Active] The application will type whatever text is currently in your system clipboard when started.";
    textInput.value = "";
    textCounter.textContent = "Clipboard Text Mode";
  } else {
    textInput.disabled = false;
    textInput.placeholder = "Paste or type your text here. Only safe characters will type. Tab and Enter are simulated as standard navigation/newlines.";
    loadSavedTextOnly().then(() => {
      updateCounters();
    });
  }
}

// Apply selected theme dynamically
function applyTheme(themeName) {
  document.body.classList.remove('theme-sunset', 'theme-cyberpunk', 'theme-forest');
  if (themeName !== 'default') {
    document.body.classList.add(`theme-${themeName}`);
  }
  
  // Highlight active theme toggle buttons
  const buttons = document.querySelectorAll('.theme-select-btn');
  buttons.forEach(btn => {
    if (btn.dataset.theme === themeName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Save settings to disk
async function persistSettings() {
  const settings = {
    text: textInput.value,
    delayMs: state.delayMs,
    jitterMs: state.jitterMs,
    countdownVal: state.countdownVal,
    typeMode: state.typeMode,
    startShortcut: state.startShortcut,
    stopShortcut: state.stopShortcut,
    useClipboard: state.useClipboard,
    theme: state.theme,
    soundEnabled: state.soundEnabled
  };
  try {
    await window.api.saveSettings(settings);
  } catch (err) {
    console.error("Failed to persist settings:", err);
  }
}

// UI Event Listeners - Sliders & Inputs
textInput.addEventListener('input', () => {
  state.lastManualText = textInput.value;
  updateCounters();
  persistSettings();
});

delaySlider.addEventListener('input', (e) => {
  state.delayMs = parseInt(e.target.value, 10);
  // Sane minimum validation
  if (state.delayMs < 30) state.delayMs = 30;
  delayVal.textContent = `${state.delayMs} ms`;
  validateJitter();
  persistSettings();
});

jitterSlider.addEventListener('input', (e) => {
  state.jitterMs = parseInt(e.target.value, 10);
  validateJitter();
  jitterVal.textContent = `${state.jitterMs} ms`;
  persistSettings();
});

countdownSlider.addEventListener('input', (e) => {
  state.countdownVal = parseInt(e.target.value, 10);
  countdownValEl.textContent = state.countdownVal === 0 ? "Instant" : `${state.countdownVal} sec`;
  persistSettings();
});

// Mode Toggle Listener
modeToggle.addEventListener('click', (e) => {
  if (e.target.classList.contains('toggle-btn')) {
    const buttons = modeToggle.querySelectorAll('.toggle-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    
    e.target.classList.add('active');
    state.typeMode = e.target.dataset.value;
    log(`Typing mode changed to: ${state.typeMode}`);
    persistSettings();
  }
});

// Clipboard Toggle Listener
clipboardToggle.addEventListener('change', (e) => {
  state.useClipboard = e.target.checked;
  toggleClipboardUI(state.useClipboard);
  persistSettings();
});

// Jitter check helper to prevent jitter being larger than delay
function validateJitter() {
  // Jitter shouldn't exceed delay time to keep typing rhythm stable and prevent errors
  const maxAllowedJitter = Math.floor(state.delayMs / 2);
  if (state.jitterMs > maxAllowedJitter) {
    state.jitterMs = maxAllowedJitter;
    jitterSlider.value = state.jitterMs;
    jitterVal.textContent = `${state.jitterMs} ms`;
    log(`Jitter clamped to ${state.jitterMs} ms (max half of typing delay) to prevent irregular key flow.`, 'info');
  }
  jitterSlider.max = maxAllowedJitter;
}

// Update Status UI state helper
function setStatus(badgeClass, text) {
  statusBadge.className = `badge ${badgeClass}`;
  statusBadge.textContent = text;
}

// Disable/Enable Input Fields
function setInputsDisabled(disabled) {
  textInput.disabled = disabled || state.useClipboard;
  delaySlider.disabled = disabled;
  jitterSlider.disabled = disabled;
  countdownSlider.disabled = disabled;
  clipboardToggle.disabled = disabled;
  startHotkeyBtn.disabled = disabled;
  stopHotkeyBtn.disabled = disabled;
  settingsBtn.disabled = disabled;
  
  const buttons = modeToggle.querySelectorAll('.toggle-btn');
  buttons.forEach(btn => btn.disabled = disabled);
}

// Reset UI to idle state
function resetUI() {
  state.isArmed = false;
  state.isTyping = false;
  clearInterval(state.countdownInterval);
  
  countdownOverlay.classList.remove('active');
  targetConfirmBox.classList.remove('active');
  safetyDisplay.style.display = 'flex';
  
  setStatus('status-idle', 'Idle');
  setInputsDisabled(false);
  
  armBtn.disabled = false;
  armBtn.textContent = '⚡ Arm & Start';
  stopBtn.disabled = true;
}

// Arm and Start Action
async function startArming() {
  if (state.isArmed || state.isTyping) return;
  
  let text = "";
  if (state.useClipboard) {
    try {
      text = await window.api.readClipboard();
    } catch (clipErr) {
      log(`Failed to read clipboard: ${clipErr.message}`, 'error');
      return;
    }
    if (!text) {
      log("Cannot start: Clipboard is empty or contains no readable text.", "error");
      return;
    }
  } else {
    text = textInput.value;
    if (!text) {
      log("Cannot start: Text field is empty.", "error");
      return;
    }
  }
  
  state.isArmed = true;
  setInputsDisabled(true);
  armBtn.disabled = true;
  stopBtn.disabled = false;
  
  log(state.countdownVal === 0 ? "App ARMED. Initializing typing instantly..." : `App ARMED. Starting ${state.countdownVal}s focus countdown.`, 'success');
  setStatus('status-armed', 'Armed');
  
  if (state.countdownVal === 0) {
    // Instant start - bypass timer overlay
    triggerTyping(text);
    return;
  }
  
  // Show countdown overlay
  countdownOverlay.classList.add('active');
  countdownTarget.textContent = "";
  
  let timeLeft = state.countdownVal;
  countdownNumber.textContent = timeLeft;
  
  state.countdownInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft > 0) {
      countdownNumber.textContent = timeLeft;
    } else {
      clearInterval(state.countdownInterval);
      countdownOverlay.classList.remove('active');
      triggerTyping(text);
    }
  }, 1000);
}

// Start Actual Keystroke Script
function triggerTyping(text) {
  state.isTyping = true;
  setStatus('status-typing', 'Typing');
  log("Target window selection locked. Spawning typing process...");
  
  window.api.startTyping({
    text: text,
    delayMs: state.delayMs,
    jitterMs: state.jitterMs,
    typeMode: state.typeMode
  });
}

// Stop Action
function stop() {
  if (!state.isArmed && !state.isTyping) return;
  
  log("Stop signal triggered. Halting typing process...", 'warn');
  window.api.stopTyping();
  
  if (state.countdownInterval) {
    clearInterval(state.countdownInterval);
  }
  
  resetUI();
}

// Bind Button Clicks
armBtn.addEventListener('click', startArming);
stopBtn.addEventListener('click', stop);



// Helper: Trigger Electron hotkey updates
async function updateRegisteredHotkeys() {
  try {
    const res = await window.api.updateHotkeys({
      startShortcut: state.startShortcut,
      stopShortcut: state.stopShortcut
    });
    
    if (res && !res.success) {
      log(res.error, 'error');
      // Reset variables to defaults
      state.startShortcut = 'F6';
      state.stopShortcut = 'Ctrl+Alt+S';
      startHotkeyBtn.textContent = state.startShortcut;
      stopHotkeyBtn.textContent = state.stopShortcut;
    } else {
      log("Global hotkeys successfully updated.", 'success');
    }
    
    persistSettings();
  } catch (err) {
    log(`Failed to update hotkeys: ${err.message}`, 'error');
  }
}

// Hotkey Recording Event Handler helper
function startRecording(type) {
  if (state.isArmed || state.isTyping) return;
  
  state.isRecordingHotkey = type;
  setInputsDisabled(true);
  
  const targetBtn = type === 'start' ? startHotkeyBtn : stopHotkeyBtn;
  targetBtn.classList.add('active');
  targetBtn.textContent = "Press key combination...";
  
  log(`Recording custom ${type} hotkey. Press any modifier combination (Ctrl, Alt, Shift) + Key to bind.`);
}

startHotkeyBtn.addEventListener('click', () => startRecording('start'));
stopHotkeyBtn.addEventListener('click', () => startRecording('stop'));

// Capture keyboard combination globally when recording
window.addEventListener('keydown', (e) => {
  if (!state.isRecordingHotkey) return;
  
  e.preventDefault();
  e.stopPropagation();
  
  const key = e.key;
  
  // Ignore raw modifier key releases
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    let mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    
    const targetBtn = state.isRecordingHotkey === 'start' ? startHotkeyBtn : stopHotkeyBtn;
    targetBtn.textContent = mods.length > 0 ? `${mods.join('+')}+...` : "Press key combination...";
    return;
  }
  
  // Map keys to match Electron's accelerator specification
  let keyName = key;
  const keyLower = key.toLowerCase();
  
  const keyMap = {
    ' ': 'Space',
    'arrowup': 'Up',
    'arrowdown': 'Down',
    'arrowleft': 'Left',
    'arrowright': 'Right',
    'pageup': 'PageUp',
    'pagedown': 'PageDown',
    'escape': 'Escape',
    'backspace': 'Backspace',
    'delete': 'Delete',
    'insert': 'Insert',
    'home': 'Home',
    'end': 'End',
    'tab': 'Tab',
    'enter': 'Enter'
  };
  
  if (keyMap[keyLower]) {
    keyName = keyMap[keyLower];
  } else if (/^f[0-9]{1,2}$/.test(keyLower)) {
    keyName = keyLower.toUpperCase();
  } else {
    keyName = key.toUpperCase();
  }
  
  // Format accelerator string
  let parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(keyName);
  
  const accelerator = parts.join('+');
  
  const targetBtn = state.isRecordingHotkey === 'start' ? startHotkeyBtn : stopHotkeyBtn;
  targetBtn.classList.remove('active');
  
  if (state.isRecordingHotkey === 'start') {
    state.startShortcut = accelerator;
    log(`Custom Start/Arm shortcut set: ${accelerator}`);
  } else {
    state.stopShortcut = accelerator;
    log(`Custom Emergency Stop shortcut set: ${accelerator}`);
  }
  
  targetBtn.textContent = accelerator;
  
  // Deactivate recording
  state.isRecordingHotkey = null;
  setInputsDisabled(false);
  
  // Commit and notify main process
  updateRegisteredHotkeys();
});

// IPC Listener hooks from preload.js
window.api.onTypingStarted(() => {
  log("Keystroke emulation started.", 'success');
});

window.api.onTypingStopped((reason) => {
  log(`Keystroke emulation stopped. Reason: ${reason || 'Finished'}`, 'info');
  resetUI();
});

window.api.onStatusUpdate((data) => {
  if (!data) return;
  
  if (data.state === 'typing') {
    setStatus('status-typing', 'Typing');
    
    // Show verified target application details
    safetyDisplay.style.display = 'none';
    targetConfirmBox.classList.add('active');
    const targetTitle = data.message.replace("Locked to: ", "");
    targetText.replaceChildren('Typing locked to window: ');
    const strongTitle = document.createElement('strong');
    strongTitle.textContent = targetTitle || 'Untitled window';
    targetText.appendChild(strongTitle);
    log(data.message, 'success');
    
  } else if (data.state === 'idle') {
    log(data.message, 'info');
    resetUI();
  } else if (data.state === 'error') {
    log(data.message, 'error');
    setStatus('status-error', 'Error');
    setTimeout(resetUI, 3000);
  }
});

// Global Hotkey handler
window.api.onHotkeyStart(() => {
  if (!state.isArmed && !state.isTyping) {
    log(`Global Hotkey [${state.startShortcut}] triggered.`);
    startArming();
  }
});

// Settings Panel Event Bindings
settingsBtn.addEventListener('click', () => {
  if (!state.isArmed && !state.isTyping) {
    homePanel.style.display = 'none';
    settingsPanel.style.display = 'flex';
  }
});

closeSettingsBtn.addEventListener('click', () => {
  settingsPanel.style.display = 'none';
  homePanel.style.display = 'flex';
});

// Bind Theme Selectors
document.querySelectorAll('.theme-select-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    state.theme = e.target.dataset.theme;
    applyTheme(state.theme);
    persistSettings();
  });
});

// Sound Toggle Listener
soundToggle.addEventListener('change', (e) => {
  state.soundEnabled = e.target.checked;
  persistSettings();
});

// Restore Defaults Action
resetDefaultsBtn.addEventListener('click', () => {
  if (confirm("Restore all settings to default values?")) {
    state = {
      isArmed: false,
      isTyping: false,
      countdownVal: 0,
      delayMs: 50,
      jitterMs: 10,
      typeMode: 'character',
      countdownInterval: null,
      startShortcut: 'F6',
      stopShortcut: 'Ctrl+Alt+S',
      isRecordingHotkey: null,
      useClipboard: false,
      theme: 'default',
      soundEnabled: false
    };
    
    // Reset inputs
    textInput.value = "";
    delaySlider.value = 50;
    delayVal.textContent = "50 ms";
    jitterSlider.value = 10;
    jitterVal.textContent = "10 ms";
    countdownSlider.value = 0;
    countdownValEl.textContent = "Instant";
    
    clipboardToggle.checked = false;
    toggleClipboardUI(false);
    
    soundToggle.checked = false;
    applyTheme('default');
    
    startHotkeyBtn.textContent = "F6";
    stopHotkeyBtn.textContent = "Ctrl+Alt+S";
    
    updateCounters();
    
    // Sync hotkeys with main process
    updateRegisteredHotkeys();
    
    log("All settings restored to defaults.", "warn");
    settingsPanel.style.display = 'none';
    homePanel.style.display = 'flex';
  }
});

// Web Audio Keyclick Synthesis (Mechanical switch pop)
let audioCtx = null;
function playKeyclick() {
  if (!state.soundEnabled) return;
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    const now = audioCtx.currentTime;
    
    // High transient pitch sweep for keyboard press sound
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1400, now);
    osc.frequency.exponentialRampToValueAtTime(250, now + 0.04);
    
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    
    osc.start(now);
    osc.stop(now + 0.05);
  } catch (err) {
    console.error("Audio synthesis failed:", err);
  }
}

// Keystroke sound click triggers from Main process
window.api.onCharTyped(() => {
  playKeyclick();
});

// Initialize on Load
document.addEventListener('DOMContentLoaded', () => {
  loadSavedSettings();
});
