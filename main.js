const { app, BrowserWindow, ipcMain } = require("electron");
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

// =======================
// ENV HELPERS
// =======================
function getEnvPaths() {
  const userEnvPath = path.join(app.getPath("userData"), ".env");
  const packagedEnvPath = path.join(process.resourcesPath, ".env");
  const devEnvPath = path.join(__dirname, ".env");
  return { userEnvPath, packagedEnvPath, devEnvPath };
}

function loadEnv() {
  const { userEnvPath, packagedEnvPath, devEnvPath } = getEnvPaths();

  const chosenEnvPath = fs.existsSync(userEnvPath)
    ? userEnvPath
    : app.isPackaged
      ? packagedEnvPath
      : devEnvPath;

  const result = dotenv.config({ path: chosenEnvPath });
  return { envPath: chosenEnvPath, result };
}

function parseEnvFile(contents) {
  const lines = contents.split(/\r?\n/);
  const out = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    out[key] = val;
  }
  return out;
}

function serializeEnvFile(envObj) {
  const keys = Object.keys(envObj).sort();
  const lines = [];
  for (const k of keys) {
    if (envObj[k] === undefined || envObj[k] === null) continue;
    lines.push(`${k}=${envObj[k]}`);
  }
  return lines.join("\n") + "\n";
}

function ensureUserEnvDir() {
  const { userEnvPath } = getEnvPaths();
  const dir = path.dirname(userEnvPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readUserEnvObject() {
  const { userEnvPath } = getEnvPaths();
  if (!fs.existsSync(userEnvPath)) return {};
  return parseEnvFile(fs.readFileSync(userEnvPath, "utf8"));
}

// Solo “upsert” de lo que el usuario configura (en este caso AGENT_KEY)
function upsertUserEnv(valuesToSet) {
  ensureUserEnvDir();
  const { userEnvPath } = getEnvPaths();

  const existing = readUserEnvObject();
  const merged = { ...existing, ...valuesToSet };

  fs.writeFileSync(userEnvPath, serializeEnvFile(merged), "utf8");
  return userEnvPath;
}

// =======================
// LOAD ENV ON STARTUP
// =======================
const { envPath, result: envResult } = loadEnv();

writeLog(`🧪 ENV loaded from: ${envPath}`);
if (envResult && envResult.error) {
  writeLog(`❌ ENV load error: ${envResult.error.message}`);
}

writeLog(
  `🧪 ENV status: SERVER_BASE_URL=${process.env.SERVER_BASE_URL ? "✅" : "❌"}, AGENT_KEY=${process.env.AGENT_KEY ? "✅" : "❌"}, AGENT_ID=${process.env.AGENT_ID ? process.env.AGENT_ID : "(empty)"}`
);

// =======================
// CONSOLE -> FILE LOG BRIDGE
// =======================
const originalLog = console.log;
const originalErr = console.error;

console.log = (...args) => {
  try {
    writeLog(args.map(String).join(" "));
  } catch (_) {}
  originalLog(...args);
};

console.error = (...args) => {
  try {
    writeLog("ERROR: " + args.map(String).join(" "));
  } catch (_) {}
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
    .catch((err) => writeLog("❌ Update check failed: " + err.message))
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
// CONFIG WINDOW (UI) - only AGENT_KEY
// =======================
let configWindow = null;

function openConfigWindow() {
  if (configWindow && !configWindow.isDestroyed()) {
    configWindow.focus();
    return;
  }

  configWindow = new BrowserWindow({
    width: 420,
    height: 280,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: true,
    title: "Tracenium Agent - Agent Key",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  configWindow.removeMenu();
  configWindow.loadFile(path.join(__dirname, "config.html"));

  configWindow.on("closed", () => {
    configWindow = null;
  });
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
// SCHEDULERS (cron + heartbeat) - start once
// =======================
let schedulersStarted = false;
let heartbeatIntervalId = null;

function startSchedulers() {
  const scheduleEnabled =
    String(process.env.SCHEDULE_ENABLED || "true").toLowerCase() === "true";

  if (!scheduleEnabled) {
    writeLog("⏸ SCHEDULE_ENABLED=false → cron y heartbeat deshabilitados");
    return;
  }

  if (schedulersStarted) {
    writeLog("ℹ Schedulers already started. Skipping.");
    return;
  }

  schedulersStarted = true;

  cron.schedule("30 13 * * *", () => {
    writeLog("⏰ Running scheduled 1:30 PM inventory...");
    executeInventory();
  });

  writeLog("🕒 Cron registered: 30 13 * * *");

  heartbeatIntervalId = setInterval(() => {
    writeLog("💓 Agent heartbeat");
  }, 10 * 60 * 1000);
}


// =======================
// IPC (CONFIG)
// =======================
ipcMain.handle("agentConfig:getCurrent", async () => {
  const userEnv = readUserEnvObject();

  // Solo regresamos lo necesario para la UI
  return {
    agentKey: userEnv.AGENT_KEY || process.env.AGENT_KEY || "",
  };
});

ipcMain.handle("agentConfig:save", async (_event, payload) => {
  const agentKey = String(payload?.agentKey || "").trim();

  if (!agentKey) return { ok: false, error: "AGENT_KEY es requerido." };

  // Guardar SOLO AGENT_KEY en userData/.env
  const savedPath = upsertUserEnv({ AGENT_KEY: agentKey });

  // Recargar env desde el archivo guardado (para que process.env ya lo tenga)
  dotenv.config({ path: savedPath });

  writeLog(`✅ AgentKey guardado en: ${savedPath}`);
  writeLog(
    `🧪 ENV status (after save): SERVER_BASE_URL=${process.env.SERVER_BASE_URL ? "✅" : "❌"}, AGENT_KEY=${process.env.AGENT_KEY ? "✅" : "❌"}, AGENT_ID=${process.env.AGENT_ID ? process.env.AGENT_ID : "(empty)"}`
  );

  // Cerrar ventana config
  if (configWindow && !configWindow.isDestroyed()) {
    configWindow.close();
  }

  // Arrancar schedulers + inventories ahora que ya hay config
  startSchedulers();

  // Inventario inmediato
  executeInventory();

  // Delayed inventario (5 min)
  setTimeout(() => {
    writeLog("⏱ Delayed inventory (5 min) (after agentKey save)");
    executeInventory();
  }, 5 * 60 * 1000);

  return { ok: true, savedPath };
});

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

  const hasServerBaseUrl = Boolean((process.env.SERVER_BASE_URL || "").trim());
  const hasAgentKey = Boolean((process.env.AGENT_KEY || "").trim());

  // Si falta SERVER_BASE_URL, eso es error de build/config (no del usuario)
  if (!hasServerBaseUrl) {
    writeLog("❌ SERVER_BASE_URL faltante. Revisa el .env empaquetado en Resources.");
    // Aun así abrimos config solo si quieres (pero no sirve sin URL)
    openConfigWindow();
    return;
  }

  // Si falta AgentKey, pedimos UI
  if (!hasAgentKey) {
    writeLog("⚠ AGENT_KEY faltante. Abriendo ventana de captura...");
    openConfigWindow();
    return;
  }

  // Si todo está OK: arrancar schedulers + inventories
  startSchedulers();

  // Inmediato
  executeInventory();

  // 5 minutos después
  setTimeout(() => {
    writeLog("⏱ Delayed inventory (5 min)");
    executeInventory();
  }, 5 * 60 * 1000);
});

app.on("window-all-closed", (e) => e.preventDefault());
