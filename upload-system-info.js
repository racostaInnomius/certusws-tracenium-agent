/**
 * upload-system-info.js
 * - Sube inventario al server vía PUT /api/v1/agents/:agentId/system-info
 * - Incluye agentKey mandatorio (por default en header x-agent-key)
 */

"use strict";

const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;
const os = require("os");

try {
  require("dotenv").config();
} catch (e) {
  console.warn("⚠️ dotenv no disponible. Continuando sin cargar .env automáticamente.");
}

async function getFetch() {
  if (typeof fetch === "function") return fetch;
  try {
    const nodeFetch = require("node-fetch");
    return nodeFetch;
  } catch (e) {
    throw new Error("No se encontró fetch global ni node-fetch.");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readEnvNumber(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : def;
}

function readEnvString(name, def) {
  return (process.env[name] || "").trim() || def;
}

function maskKey(key) {
  return key ? `${key.slice(0, 3)}***${key.slice(-3)}` : "";
}

function buildEndpointUrl(baseUrl, agentId) {
  return `${baseUrl.replace(/\/+$/, "")}/api/v1/agents/${encodeURIComponent(
    agentId
  )}/system-info`;
}

async function checkDns(url) {
  try {
    const { hostname } = new URL(url);
    await dns.lookup(hostname);
    return true;
  } catch {
    return false;
  }
}

async function sendToServer({
  endpointUrl,
  payload,
  agentKey,
  agentKeyHeader,
  sendInBody,
}) {
  const f = await getFetch();

  const headers = {
    "Content-Type": "application/json",
    [agentKeyHeader]: agentKey,
  };

  const body = sendInBody ? { ...payload, agentKey } : payload;

  const res = await f(endpointUrl, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || "sin cuerpo"}`);
  }

  return res;
}

async function uploadSystemInfo(systemInfo) {
  if (!systemInfo || typeof systemInfo !== "object") {
    throw new Error("systemInfo inválido");
  }

  const SERVER_BASE_URL = readEnvString("SERVER_BASE_URL", "");
  const AGENT_KEY = readEnvString("AGENT_KEY", "");
  const AGENT_KEY_HEADER_NAME = readEnvString("AGENT_KEY_HEADER_NAME", "x-agent-key");
  const SEND_AGENT_KEY_IN_BODY =
    readEnvString("SEND_AGENT_KEY_IN_BODY", "false").toLowerCase() === "true";

  const MAX_RETRIES = readEnvNumber("MAX_RETRIES", 5);
  const RETRY_DELAY_MS = readEnvNumber("RETRY_DELAY_MS", 3000);

  const AGENT_ID =
    process.env.AGENT_ID === "auto"
      ? os.hostname()
      : process.env.AGENT_ID || os.hostname();

  if (!SERVER_BASE_URL) throw new Error("SERVER_BASE_URL no configurado");
  if (!AGENT_KEY) throw new Error("AGENT_KEY no configurado");

  const endpointUrl = buildEndpointUrl(SERVER_BASE_URL, AGENT_ID);

  if (!(await checkDns(endpointUrl))) {
    console.warn("⚠️ DNS no resolvió host del server");
  }

  console.log("📡 Subiendo inventario");
  console.log("   🆔 Agent ID:", AGENT_ID);
  console.log("   🔑 Agent Key:", `(${maskKey(AGENT_KEY)})`);
  console.log("   🌐 Endpoint:", endpointUrl);

  let lastErr;

  for (let i = 1; i <= MAX_RETRIES; i++) {
    try {
      console.log(`➡️ Intento ${i}/${MAX_RETRIES}`);
      await sendToServer({
        endpointUrl,
        payload: systemInfo,
        agentKey: AGENT_KEY,
        agentKeyHeader: AGENT_KEY_HEADER_NAME,
        sendInBody: SEND_AGENT_KEY_IN_BODY,
      });
      console.log("✅ Upload exitoso");
      return true;
    } catch (e) {
      lastErr = e;
      console.error("❌ Error:", e.message);
      if (i < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }

  throw lastErr;
}

async function runCli() {
  const args = process.argv.slice(2);
  const idx = args.findIndex((a) => a === "--file" || a === "-f");
  const file = idx >= 0 ? args[idx + 1] : null;

  if (!file) {
    console.log("Uso: node upload-system-info.js --file system-info.json");
    process.exit(1);
  }

  const fullPath = path.resolve(process.cwd(), file);
  const json = JSON.parse(fs.readFileSync(fullPath, "utf8"));

  await uploadSystemInfo(json);
}

if (require.main === module) {
  runCli().catch((e) => {
    console.error("❌", e.message);
    process.exit(2);
  });
}

module.exports = { uploadSystemInfo };
