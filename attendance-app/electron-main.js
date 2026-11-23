const { app, BrowserWindow, Menu, dialog } = require('electron');
const path = require('path');
const http = require('http');

let mainWindow = null;
let serverProcess = null;

// Start Express Backend inside the Electron process
function startBackendServer() {
  try {
    // Require server.js to run in-process or background
    require('./server.js');
    console.log('[Electron] In-process attendance server started successfully.');
  } catch (err) {
    console.error('[Electron] Failed to start backend server:', err);
  }
}

function waitForServer(callback, retries = 20) {
  http.get('http://localhost:4000/api/whatsapp/status', (res) => {
    callback();
  }).on('error', (err) => {
    if (retries > 0) {
      setTimeout(() => waitForServer(callback, retries - 1), 500);
    } else {
      callback(); // Proceed anyway
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 700,
    title: 'DOT-CMC Attendance Kiosk',
    icon: path.join(__dirname, 'public', 'icon.png'),
    backgroundColor: '#030712',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  Menu.setApplicationMenu(null); // Clean kiosk look without standard top menu

  mainWindow.loadURL('http://localhost:4000');

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startBackendServer();
  waitForServer(() => {
    createWindow();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
