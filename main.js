const { app, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");
const dotenv = require("dotenv");

// =======================
// SINGLE INSTANCE
// =======================
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.disableHardwareAcceleration();

// =======================
// ENV (.env) LOAD
// =======================
// En build empaquetado, electron-builder coloca .env en: process.resourcesPath/.env
// Ej: /Applications/Tracenium Agent.app/Contents/Resources/.env
const envPath = app.isPackaged
  ? path.join(process.resourcesPath, ".env")
  : path.join(__dirname, ".env");

dotenv.config({ path: envPath });

const envResult = dotenv.config({ path: envPath });
if (envResult.error) {
  writeLog(`❌ ENV load error: ${envResult.error.message}`);
}

// =======================
// LOGGING
// =======================

const LOG_DIR = path.join(app.getPath("userData"), "logs");
const LOG_FILE = path.join(LOG_DIR, "agent.log");
const MAX_LINES = 10000;

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function writeLog(line) {
  ensureLogDir();
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${line}\n`;

  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, entry);
    return;
  }

  const lines = fs.readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean);

  if (lines.length > MAX_LINES) {
    fs.renameSync(LOG_FILE, LOG_FILE + ".1");
    fs.writeFileSync(LOG_FILE, entry);
  } else {
    fs.appendFileSync(LOG_FILE, entry);
  }
}

writeLog("🔄 Agent starting...");

// Log útil para debug (no imprime secretos)
writeLog(`🧪 ENV loaded from: ${envPath}`);
writeLog(
  `🧪 ENV status: SERVER_BASE_URL=${process.env.SERVER_BASE_URL ? "✅" : "❌"}, AGENT_KEY=${process.env.AGENT_KEY ? "✅" : "❌"}, AGENT_ID=${process.env.AGENT_ID ? process.env.AGENT_ID : "(empty)"}`
);


// =======================
// CONSOLE -> FILE LOG BRIDGE
// =======================
const originalLog = console.log;
const originalErr = console.error;

console.log = (...args) => {
  try { writeLog(args.map(String).join(" ")); } catch (_) {}
  originalLog(...args);
};

console.error = (...args) => {
  try { writeLog("ERROR: " + args.map(String).join(" ")); } catch (_) {}
  originalErr(...args);
};

// =======================
// INVENTORY
// =======================

let runInventory;
try {
  runInventory = require("./index").runInventory;
  writeLog("Inventory module loaded OK.");
} catch (err) {
  writeLog("❌ ERROR loading inventory module: " + err.message);
}

// =======================
// AUTO UPDATE
// =======================

let updateCheckInProgress = false;

function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () =>
    writeLog("🔍 Checking for update...")
  );

  autoUpdater.on("update-available", (info) =>
    writeLog(`⬆️ Update available: ${info.version}`)
  );

  autoUpdater.on("update-not-available", () =>
    writeLog("✔ No updates available.")
  );

  autoUpdater.on("error", (err) =>
    writeLog("❌ Auto-update error: " + err.message)
  );

  autoUpdater.on("update-downloaded", () => {
    writeLog("📦 Update downloaded. Installing...");
    autoUpdater.quitAndInstall(false, true);
  });

  checkForUpdatesSafely();

  // 🔁 Polling cada 6 horas
  setInterval(() => {
    writeLog("⏳ Periodic update check (6h)...");
    checkForUpdatesSafely();
  }, 6 * 60 * 60 * 1000);
}

function checkForUpdatesSafely() {
  if (updateCheckInProgress) {
    writeLog("⚠ Update check skipped (already running)");
    return;
  }

  updateCheckInProgress = true;

  autoUpdater
    .checkForUpdates()
    .catch((err) =>
      writeLog("❌ Update check failed: " + err.message)
    )
    .finally(() => {
      updateCheckInProgress = false;
    });
}

// =======================
// WINDOW (HIDDEN)
// =======================

let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    show: false,
  });

  mainWindow.on("close", (e) => e.preventDefault());
}

// =======================
// INVENTORY EXECUTION
// =======================

async function executeInventory() {
  if (!runInventory) {
    writeLog("❌ runInventory undefined");
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
// APP READY
// =======================

app.whenReady().then(() => {
  app.setAppUserModelId("com.tracenium.agent");
  createWindow();
  writeLog("App ready.");

  if (app.isPackaged) {
    setupAutoUpdater();
  }

  // 1️⃣ Inmediato
  executeInventory();

  // 2️⃣ 5 minutos después
  setTimeout(() => {
    writeLog("⏱ Delayed inventory (5 min)");
    executeInventory();
  }, 5 * 60 * 1000);

  // 3️⃣ Cron diario 1:30 PM
  cron.schedule("30 13 * * *", () => {
    writeLog("⏰ Running scheduled 1:30 PM inventory...");
    executeInventory();
  });

  writeLog("🕒 Cron registered: 30 13 * * *");

  // 💓 Heartbeat
  setInterval(() => {
    writeLog("💓 Agent heartbeat");
  }, 10 * 60 * 1000);
});

app.on("window-all-closed", (e) => e.preventDefault());
