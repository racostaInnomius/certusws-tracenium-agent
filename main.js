const { app, BrowserWindow } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false, // No se muestra, es un agente
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Cargamos un HTML mínimo o ninguno
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  // AUTO UPDATES
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('update-available', (info) => {
    console.log('🔄 Update available:', info.version);
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('⬇️ Update downloaded. Installing on quit...');
  });
});

app.on('window-all-closed', () => {
  // Esto permite que en macOS la app siga corriendo en background
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
