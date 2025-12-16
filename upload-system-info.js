// upload-system-info.js
// - Sube el inventario al servidor (PUT)
// - Soporta ejecución en Electron empaquetado
// - Maneja reintentos si no hay conectividad

const path = require("path");
const os = require("os");
const fs = require("fs/promises");
const { constants } = require("fs");
const dns = require("dns/promises");
const dotenv = require("dotenv");

// Electron solo existe cuando estamos empaquetados
let app;
try {
  ({ app } = require("electron"));
} catch {
  app = null;
}

// =======================
// CARGA CORRECTA DEL .env
// =======================

const envPath =
  app && app.isPackaged
    ? path.join(process.resourcesPath, ".env") // Electron PROD
    : path.join(process.cwd(), ".env");        // DEV / local

dotenv.config({ path: envPath });

// =======================
// CONFIGURACIÓN
// =======================

const DEFAULT_SYSTEM_INFO_PATH = "./system-info.json";

const SERVER_BASE_URL =
  process.env.SERVER_BASE_URL || "http://localhost:3000";

const AGENT_ID =
  process.env.AGENT_ID === "auto"
    ? os.hostname()
    : process.env.AGENT_ID || os.hostname();

const ENDPOINT_URL = `${SERVER_BASE_URL}/api/v1/agents/${encodeURIComponent(
  AGENT_ID
)}/system-info`;

// Reintentos
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 30_000; // 30 segundos

// =======================
// HELPERS
// =======================

// ¿Existe el archivo?
async function fileExists(filePath) {
  try {
    await fs.access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ¿Hay conectividad?
async function hasInternet() {
  try {
    await dns.resolve("google.com");
    return true;
  } catch {
    return false;
  }
}

// Lee y parsea system-info.json
async function readSystemInfo(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

// Envía el JSON al backend
async function sendToServer(data) {
  const response = await fetch(ENDPOINT_URL, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Servidor respondió ${response.status}: ${text || "sin cuerpo"}`
    );
  }

  return response;
}

// Lógica con reintentos
async function uploadWithRetry(data, attempt = 1) {
  console.log(`🔁 Upload intento ${attempt}/${MAX_RETRIES}`);
  console.log(`🌐 Endpoint: ${ENDPOINT_URL}`);

  const online = await hasInternet();
  if (!online) {
    if (attempt >= MAX_RETRIES) {
      console.error("❌ Sin conexión después de varios intentos.");
      return;
    }

    console.warn(
      `⚠️ Sin internet. Reintentando en ${RETRY_DELAY_MS / 1000}s...`
    );
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return uploadWithRetry(data, attempt + 1);
  }

  try {
    await sendToServer(data);
    console.log("✅ Inventario enviado correctamente.");
  } catch (err) {
    console.error("❌ Error enviando inventario:", err.message);

    if (attempt >= MAX_RETRIES) {
      console.error("❌ Máximo de reintentos alcanzado.");
      return;
    }

    console.warn(
      `⚠️ Reintentando envío en ${RETRY_DELAY_MS / 1000}s...`
    );
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return uploadWithRetry(data, attempt + 1);
  }
}

// =======================
// API PRINCIPAL
// =======================

// Usado desde index.js (recomendado)
async function uploadSystemInfo(systemInfoObject) {
  if (!systemInfoObject || typeof systemInfoObject !== "object") {
    throw new Error("systemInfoObject inválido.");
  }

  console.log("📦 Inventario recibido en memoria.");
  console.log("📍 .env usado desde:", envPath);
  console.log("🆔 AGENT_ID:", AGENT_ID);

  await uploadWithRetry(systemInfoObject);
}

// Para pruebas manuales
async function uploadSystemInfoFromFile(
  filePath = DEFAULT_SYSTEM_INFO_PATH
) {
  const exists = await fileExists(filePath);
  if (!exists) {
    throw new Error(`No existe ${filePath}`);
  }

  const systemInfo = await readSystemInfo(filePath);

  console.log(`📄 ${filePath} cargado correctamente.`);
  console.log("📍 .env usado desde:", envPath);
  console.log("🆔 AGENT_ID:", AGENT_ID);

  await uploadWithRetry(systemInfo);
}

module.exports = {
  uploadSystemInfo,
  uploadSystemInfoFromFile,
};

// =======================
// EJECUCIÓN DIRECTA (CLI)
// =======================

if (require.main === module) {
  uploadSystemInfoFromFile().catch((err) => {
    console.error("❌ Error en upload-system-info:", err.message);
    process.exit(1);
  });
}
