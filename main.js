const { app, BrowserWindow, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");
const dotenv = require("dotenv");
const os = require("os");

// ✅ [PATCH] Node http/https nativo (para evitar fetch failed en macOS)
const http = require("http");
const https = require("https");

// ✅ [PATCH] helper GET JSON vía http/https nativo
function httpGetJson(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === "https:" ? https : http;

      const req = lib.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search,
          method: "GET",
          headers: headers || {},
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            let json = null;
            try {
              json = data ? JSON.parse(data) : null;
            } catch (_) {}
            resolve({ status: res.statusCode || 0, json, raw: data });
          });
        }
      );

      req.on("error", (err) => reject(err));
      req.setTimeout(timeoutMs || 8000, () => {
        req.destroy(new Error("timeout"));
      });
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

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
// PATH HELPERS (packaged vs dev)
// =======================
function firstExistingPath(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

function resolveAppAsset(filename) {
  // En packaged, electron-builder puede poner archivos en Resources (extraResources)
  // o pueden vivir dentro del app.asar (files).
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, filename) : null,
    path.join(__dirname, filename),
  ].filter(Boolean);

  return firstExistingPath(candidates);
}

// =======================
// ENV (.env) LOAD
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
  // Mantener simple: solo k=v, ordenado
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

function readEnvObjectFromFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return parseEnvFile(fs.readFileSync(filePath, "utf8"));
}

function upsertUserEnv(partial) {
  ensureUserEnvDir();

  const { userEnvPath, packagedEnvPath, devEnvPath } = getEnvPaths();

  // 1) Base env: packaged (si existe) o dev (si no)
  const basePath = fs.existsSync(packagedEnvPath) ? packagedEnvPath : devEnvPath;
  const baseObj = readEnvObjectFromFile(basePath);

  // 2) User env (si existe)
  const currentUserObj = readEnvObjectFromFile(userEnvPath);

  // 3) Merge (base -> user -> partial)
  const merged = { ...baseObj, ...currentUserObj, ...partial };

  // 4) Escribir userData/.env COMPLETO
  fs.writeFileSync(userEnvPath, serializeEnvFile(merged), "utf8");

  return userEnvPath;
}

// Cargamos env y lo reportamos
const { envPath, result: envResult } = loadEnv();

writeLog(`🧪 ENV loaded from: ${envPath}`);
if (envResult && envResult.error) {
  writeLog(`❌ ENV load error: ${envResult.error.message}`);
}

writeLog(
  `🧪 ENV status: SERVER_BASE_URL=${process.env.SERVER_BASE_URL ? "✅" : "❌"}, AGENT_KEY=${process.env.AGENT_KEY ? "✅" : "❌"}, AGENT_ID=${process.env.AGENT_ID ? process.env.AGENT_ID : "(empty)"}`
);

// =======================
// CLI ARGS (AgentKey via --agent-key)
// =======================
function getCliArgValue(name) {
  // soporta: --agent-key 123 | --agent-key=123
  const argv = Array.isArray(process.argv) ? process.argv : [];
  const eqPrefix = `--${name}=`;

  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || "");

    if (a.startsWith(eqPrefix)) {
      return a.substring(eqPrefix.length);
    }

    if (a === `--${name}`) {
      const next = argv[i + 1];
      if (next && !String(next).startsWith("--")) return String(next);
    }
  }

  return "";
}

function maskKey(key) {
  const s = String(key || "");
  if (s.length <= 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-3)}`;
}

async function applyAgentKeyFromCliIfPresent() {
  // Aceptamos varios aliases por si IT usa otra convención
  const cliKey =
    getCliArgValue("agent-key") ||
    getCliArgValue("agentKey") ||
    getCliArgValue("AGENT_KEY");

  const agentKey = String(cliKey || "").trim();
  if (!agentKey) return { applied: false, reason: "no-cli" };

  writeLog(`🧩 AgentKey recibido por CLI: (${maskKey(agentKey)})`);

  const base = String(process.env.SERVER_BASE_URL || "").trim();
  if (!base) {
    writeLog("❌ SERVER_BASE_URL faltante. No se puede validar AgentKey por CLI.");
    return { applied: false, reason: "no-server-base-url" };
  }

  // header configurable (default x-agent-key)
  const headerName =
    String(process.env.AGENT_KEY_HEADER_NAME || "x-agent-key").trim() || "x-agent-key";

  // Endpoint de validación (recomendado)
  const validatePath =
    String(process.env.VALIDATE_AGENT_KEY_PATH || "/api/v1/agents/validate-agent-key").trim();

  const url = base.replace(/\/+$/, "") + validatePath;

  try {
    writeLog(`🔎 Validando AgentKey por CLI en: ${url}`);

    // ✅ [PATCH] reemplazo de fetch por http/https nativo
    const { status } = await httpGetJson(
      url,
      {
        [headerName]: agentKey,
        accept: "application/json",
      },
      8000
    );

    if (status < 200 || status >= 300) {
      if (status === 401 || status === 403) {
        writeLog("❌ AgentKey CLI inválido o no autorizado. Se abrirá UI.");
      } else if (status === 404) {
        writeLog("❌ Endpoint de validación no existe (404). Se abrirá UI.");
      } else {
        writeLog(`❌ Validación CLI falló (HTTP ${status}). Se abrirá UI.`);
      }
      return { applied: false, reason: `http-${status}` };
    }

    // Guardar en userData/.env (con merge robusto)
    const savedPath = upsertUserEnv({ AGENT_KEY: agentKey });

    // Recargar env desde el archivo guardado (para que process.env ya lo tenga)
    dotenv.config({ path: savedPath });

    writeLog(`✅ AgentKey (CLI) guardado en: ${savedPath}`);
    writeLog(
      `🧪 ENV status (after CLI save): SERVER_BASE_URL=${process.env.SERVER_BASE_URL ? "✅" : "❌"}, AGENT_KEY=${process.env.AGENT_KEY ? "✅" : "❌"}, AGENT_ID=${process.env.AGENT_ID ? process.env.AGENT_ID : "(empty)"}`
    );

    return { applied: true, reason: "ok" };
  } catch (err) {
    const msg = err?.message || "unknown";
    writeLog(`❌ Error validando AgentKey por CLI (httpGetJson): ${msg}. Se abrirá UI.`);
    return { applied: false, reason: msg === "timeout" ? "timeout" : "error" };
  }
}

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

  autoUpdater.on("checking-for-update", () => writeLog("🔍 Checking for update..."));
  autoUpdater.on("update-available", (info) => writeLog(`⬆️ Update available: ${info.version}`));
  autoUpdater.on("update-not-available", () => writeLog("✔ No updates available."));
  autoUpdater.on("error", (err) => writeLog("❌ Auto-update error: " + err.message));

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
    width: 460,
    height: 340,
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

    // (Opcional) AGENT_ID auto por hostname (por si runInventory lo usa)
    // NOTA: esto NO pisa una config explícita en env.
    if (!process.env.AGENT_ID || process.env.AGENT_ID === "auto") {
      process.env.AGENT_ID = os.hostname();
    }

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
// CONFIG WINDOW (UI) - only AGENT_KEY
// =======================
let configWindow = null;

function openConfigWindow() {
  if (configWindow && !configWindow.isDestroyed()) {
    configWindow.focus();
    return;
  }

  // ✅ preload.js y config.html deben resolverse bien en packaged
  const preloadPath = resolveAppAsset("preload.js");
  const configPath = resolveAppAsset("config.html");

  writeLog(`🧪 preload.js resolved: ${preloadPath || "(NOT FOUND)"}`);
  writeLog(`🧪 config.html resolved: ${configPath || "(NOT FOUND)"}`);

  // tamaño de la ventana para agent key
  configWindow = new BrowserWindow({
    width: 445,
    height: 295,
    resizable: false,
    minimizable: false,
    maximizable: false,
    show: true,
    title: "Tracenium Agent - Agent Key",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Si preload no existe, la UI no podrá hablar con main (IPC)
      preload: preloadPath || undefined,
    },
  });

  configWindow.removeMenu();

  // Diagnóstico
  configWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    writeLog(`❌ config window did-fail-load: code=${code} desc=${desc} url=${url}`);
  });

  configWindow.webContents.on("render-process-gone", (_e, details) => {
    writeLog(`❌ config window render-process-gone: reason=${details.reason}`);
  });

  configWindow.webContents.on("console-message", (_e, level, message) => {
    writeLog(`🧩 config window console(level=${level}): ${message}`);
  });

  // Si falta config.html, fallback mínimo (para no dejar ventana en blanco)
  if (!configPath) {
    writeLog(`❌ config.html not found (packaging issue). Using fallback HTML.`);
    const fallbackHtml = `
      <!doctype html><html><body style="font-family: -apple-system; margin:16px;">
        <h2>Configurar Agent Key</h2>
        <p>No se encontró <b>config.html</b> en el build. Fallback temporal.</p>
        <input id="k" placeholder="AGENT_KEY" style="padding:10px; width:100%; box-sizing:border-box;" />
        <button id="b" style="margin-top:12px; padding:10px; width:100%;">Guardar</button>
        <div id="m" style="margin-top:10px; font-weight:700;"></div>
        <script>
          const msg = (t)=> document.getElementById('m').textContent = t;
          document.getElementById('b').onclick = async () => {
            const agentKey = document.getElementById('k').value.trim();
            if (!agentKey) return msg("AGENT_KEY requerido");
            try {
              const res = await window.agentConfig.save({ agentKey });
              msg(res.ok ? "Guardado ✅" : (res.error || "Error"));
            } catch (e) { msg("Error: " + e.message); }
          };
        </script>
      </body></html>
    `;
    configWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(fallbackHtml));
  } else {
    configWindow.loadFile(configPath);
  }

  configWindow.on("closed", () => {
    configWindow = null;
  });
}

// =======================
// IPC (CONFIG)
// =======================
ipcMain.handle("agentConfig:getCurrent", async () => {
  const userEnv = readUserEnvObject();
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

ipcMain.handle("agentConfig:getAppInfo", async () => {
  return {
    version: app.getVersion(),
  };
});

ipcMain.handle("agentConfig:cancel", async () => {
  writeLog("❎ User cancelled Agent Key entry. Quitting app...");
  app.quit();
  return { ok: true };
});

ipcMain.handle("agentConfig:validateAgentKey", async (_event, payload) => {
  try {
    const agentKey = String(payload?.agentKey || "").trim();
    if (!agentKey) return { ok: false, error: "AGENT_KEY es requerido." };

    const base = String(process.env.SERVER_BASE_URL || "").trim();
    if (!base) return { ok: false, error: "SERVER_BASE_URL no configurado." };

    // header configurable (default x-agent-key)
    const headerName =
      String(process.env.AGENT_KEY_HEADER_NAME || "x-agent-key").trim() || "x-agent-key";

    // Endpoint de validación (recomendado)
    const validatePath =
      String(process.env.VALIDATE_AGENT_KEY_PATH || "/api/v1/agents/validate-agent-key").trim();

    const url = base.replace(/\/+$/, "") + validatePath;

    // ✅ [PATCH] reemplazo de fetch por http/https nativo
    const { status, json } = await httpGetJson(
      url,
      {
        [headerName]: agentKey,
        accept: "application/json",
      },
      8000
    );

    if (status >= 200 && status < 300) {
      return { ok: true, data: json };
    }

    // Si es 401/403 -> inválido
    if (status === 401 || status === 403) {
      return { ok: false, error: "Agent Key inválido o no autorizado." };
    }

    // 404 sugiere que el endpoint no existe
    if (status === 404) {
      return { ok: false, error: "Endpoint de validación no existe en el server (404)." };
    }

    return { ok: false, error: `Validación falló (HTTP ${status}).` };
  } catch (err) {
    const msg = err?.message || "unknown";
    const isTimeout = msg === "timeout";
    return { ok: false, error: isTimeout ? "Timeout validando Agent Key." : "Error validando Agent Key." };
  }
});

// =======================
// APP READY
// =======================
app.whenReady().then(async () => {
  app.setAppUserModelId("com.tracenium.agent");
  createWindow();
  writeLog("App ready.");

  if (app.isPackaged) {
    setupAutoUpdater();
  }

  const hasServerBaseUrl = Boolean((process.env.SERVER_BASE_URL || "").trim());
  let hasAgentKey = Boolean((process.env.AGENT_KEY || "").trim());

  // Si falta SERVER_BASE_URL, eso es build/config (no del usuario)
  if (!hasServerBaseUrl) {
    writeLog("❌ SERVER_BASE_URL faltante. Revisa el .env empaquetado en Resources.");
    // Abrimos config para que al menos se vea UI (pero sin URL no sube inventario)
    openConfigWindow();
    return;
  }

  // Si no hay AgentKey en env, intentamos tomarlo por CLI (y validar/guardar)
  if (!hasAgentKey) {
    const cli = await applyAgentKeyFromCliIfPresent();
    hasAgentKey = Boolean((process.env.AGENT_KEY || "").trim());

    if (cli.applied && hasAgentKey) {
      writeLog("✅ AgentKey aplicado por CLI. Continuando sin UI...");
    } else if (!hasAgentKey) {
      writeLog("⚠ AGENT_KEY faltante. Abriendo ventana de captura...");
      openConfigWindow();
      return;
    }
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
