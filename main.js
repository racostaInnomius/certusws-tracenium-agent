const { app, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");

// =======================
// LOGGING PROFESIONAL
// =======================

const LOG_DIR = path.join(app.getPath("userData"), "logs");
const LOG_FILE = path.join(LOG_DIR, "agent.log");
const MAX_LINES = 10000;

// Crea carpeta de logs si no existe
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

// Agrega línea y rota si llega al límite
function writeLog(line) {
  ensureLogDir();

  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${line}\n`;

  // Si no existe, créalo
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, entry);
    return;
  }

  const content = fs.readFileSync(LOG_FILE, "utf8");
  const lines = content.split("\n").filter(Boolean);

  if (lines.length > MAX_LINES) {
    // Rota archivo
    fs.renameSync(LOG_FILE, LOG_FILE + ".1");
    fs.writeFileSync(LOG_FILE, entry);
  } else {
    fs.appendFileSync(LOG_FILE, entry);
  }
}

writeLog("🔄 Agent starting...");

// =======================
// AGENTE DE INVENTARIO
// =======================

let runInventory;
try {
  // index.js debe exportar: module.exports = { runInventory: main };
  runInventory = require("./index").runInventory;
  writeLog("Inventory module loaded OK.");
} catch (err) {
  writeLog("❌ ERROR loading inventory module: " + err.message);
}

// =======================
// AUTO-UPDATE SILENCIOSO
// =======================

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => writeLog("Checking for update..."));
  autoUpdater.on("update-available", (info) =>
    writeLog(`Update available: ${info.version}`)
  );
  autoUpdater.on("update-not-available", () =>
    writeLog("No updates available.")
  );
  autoUpdater.on("error", (err) =>
    writeLog("Auto-update error: " + err.message)
  );
  autoUpdater.on("update-downloaded", () => {
    writeLog("Update downloaded. Installing...");
    autoUpdater.quitAndInstall(false, true);
  });

  autoUpdater.checkForUpdates();
}

// =======================
// VENTANA (OCULTA)
// =======================

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
  });
}

// =======================
// EJECUCIÓN DEL AGENTE
// =======================

async function executeInventory() {
  if (!runInventory) {
    writeLog("❌ runInventory is undefined — cannot execute inventory.");
    return;
  }

  try {
    writeLog("▶ Executing inventory...");
    await runInventory();
    writeLog("✔ Inventory completed successfully.");
  } catch (err) {
    writeLog("❌ Inventory error: " + err.message);
  }
}

// =======================
// ARRANQUE DE LA APP
// =======================

app.whenReady().then(() => {
  createWindow();
  writeLog("App ready.");

  if (app.isPackaged) {
    setupAutoUpdater();
  }

  // 1️⃣ Inventario inmediato al iniciar
  executeInventory();

  // 2️⃣ Inventario 5 minutos después
  setTimeout(() => {
    writeLog("⏱ Running first delayed inventory (5 min)...");
    executeInventory();
  }, 5 * 60 * 1000);

  // 3️⃣ Cron diario a las 3 AM
  cron.schedule("0 3 * * *", () => {
    writeLog("⏰ Running scheduled 3AM inventory...");
    executeInventory();
  });
});

app.on("window-all-closed", (e) => {
  // No cerramos la app, porque es un agente.
  e.preventDefault();
});
