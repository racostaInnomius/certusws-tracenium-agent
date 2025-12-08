const { app, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    show: false, // no necesitamos UI visible
  });
}

// =======================
// AUTO-UPDATE SILENCIOSO
// =======================

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // Instalaremos manualmente

  autoUpdater.on("checking-for-update", () => {
    console.log("Checking for update...");
  });

  autoUpdater.on("update-available", (info) => {
    console.log(`Update available: ${info.version}. Downloading...`);
  });

  autoUpdater.on("update-not-available", () => {
    console.log("No updates available.");
  });

  autoUpdater.on("error", (err) => {
    console.error("Auto-update error:", err);
  });

  autoUpdater.on("update-downloaded", () => {
    console.log("Update downloaded. Installing silently...");

    // Instala inmediatamente SIN preguntar
    autoUpdater.quitAndInstall(false, true);
  });

  // Esto inicia el proceso de búsqueda de actualizaciones
  autoUpdater.checkForUpdates();
}

// App ready
app.whenReady().then(() => {
  createWindow();

  if (app.isPackaged) {
    setupAutoUpdater();
  }
});
