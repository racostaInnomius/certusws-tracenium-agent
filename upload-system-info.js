// upload-system-info.js
// 1) Puede subir un objeto de sistema directamente (uploadSystemInfo)
// 2) O leer system-info.json y subirlo (uploadSystemInfoFromFile)
// 3) Maneja reintentos si no hay internet
require('dotenv').config(); 

const fs = require('fs/promises');
const { constants } = require('fs');
const dns = require('dns/promises');
const os = require('os');

// 🔧 CONFIGURACIÓN
const DEFAULT_SYSTEM_INFO_PATH = './system-info.json';

// Usa el hostname como identificador del agente (se puede cambiar por un UUID)
const SERVER_BASE_URL = process.env.SERVER_BASE_URL || 'http://localhost:3000';
const AGENT_ID = process.env.AGENT_ID === 'auto' ? os.hostname() : process.env.AGENT_ID;

// Propuesta de endpoint:
const ENDPOINT_URL = `${SERVER_BASE_URL}/api/v1/agents/${encodeURIComponent(
  AGENT_ID
)}/system-info`;

// Reintentos si NO hay internet
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 30_000; // 30 segundos

// ---------- Helpers ----------

// ¿Existe el archivo?
async function fileExists(path) {
  try {
    await fs.access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ¿Tenemos conexión a internet? (prueba resolviendo google.com)
async function hasInternet() {
  try {
    await dns.resolve('google.com');
    return true;
  } catch {
    return false;
  }
}

// Lee y parsea system-info.json
async function readSystemInfo(path) {
  const raw = await fs.readFile(path, 'utf8');
  return JSON.parse(raw);
}

// Envía el JSON al endpoint con PUT
async function sendToServer(data) {
  // 👇 fetch nativo en Node 18+
  const response = await fetch(ENDPOINT_URL, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `El servidor respondió con status ${response.status}: ${text}`
    );
  }

  return response;
}

// Lógica con reintentos para conexión + envío
async function uploadWithRetry(data, attempt = 1) {
  console.log(`🔁 Intento ${attempt}/${MAX_RETRIES}`);

  const online = await hasInternet();
  if (!online) {
    if (attempt >= MAX_RETRIES) {
      console.error('❌ Sin conexión a internet después de varios intentos.');
      return;
    }

    console.warn(
      `⚠️ No hay internet. Reintentando en ${RETRY_DELAY_MS / 1000} segundos...`
    );

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return uploadWithRetry(data, attempt + 1);
  }

  // Ya hay internet, intentamos enviar
  try {
    await sendToServer(data);
    console.log('✅ Información enviada correctamente al servidor:', ENDPOINT_URL);
  } catch (err) {
    console.error('❌ Error al enviar la información:', err.message);

    if (attempt >= MAX_RETRIES) {
      console.error('❌ Llegamos al máximo de reintentos al enviar.');
      return;
    }

    console.warn(
      `⚠️ Reintentando envío en ${RETRY_DELAY_MS / 1000} segundos...`
    );

    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return uploadWithRetry(data, attempt + 1);
  }
}

// ---------- API PRINCIPAL ----------

// 1) Versión recomendada para usar desde index.js: recibe el objeto en memoria
async function uploadSystemInfo(systemInfoObject) {
  if (!systemInfoObject || typeof systemInfoObject !== 'object') {
    throw new Error('systemInfoObject no es un objeto válido.');
  }

  console.log('📄 Objeto de system-info recibido en memoria.');
  console.log(`🌐 Endpoint configurado: ${ENDPOINT_URL}`);

  await uploadWithRetry(systemInfoObject);
}

// 2) Versión para leer el archivo desde disco (útil para pruebas manuales)
async function uploadSystemInfoFromFile(path = DEFAULT_SYSTEM_INFO_PATH) {
  const exists = await fileExists(path);
  if (!exists) {
    throw new Error(`No se encontró ${path}. Genera primero el archivo.`);
  }

  let systemInfo;
  try {
    systemInfo = await readSystemInfo(path);
  } catch (err) {
    throw new Error('Error leyendo/parsing system-info.json: ' + err.message);
  }

  console.log(`📄 ${path} cargado correctamente.`);
  console.log(`🌐 Endpoint configurado: ${ENDPOINT_URL}`);

  await uploadWithRetry(systemInfo);
}

// Export para usar desde otros archivos (index.js)
module.exports = { uploadSystemInfo, uploadSystemInfoFromFile };

// Si se ejecuta directamente: corre solo el upload leyendo el archivo
if (require.main === module) {
  uploadSystemInfoFromFile().catch((err) => {
    console.error('Error inesperado en upload-system-info:', err.message);
    process.exit(1);
  });
}
