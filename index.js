const si = require('systeminformation');        // Librería para info de sistema
const wmi = require('node-wmi');               // WMI (solo Windows)
const { exec } = require('child_process');     // Para ejecutar comandos del SO
const os = require('os');                      // Para detectar plataforma
const fs = require('fs');                      // Para escribir el JSON
const { uploadSystemInfo } = require('./upload-system-info'); // Nuestro uploader
const { app } = require("electron");
const path = require("path");

// Parámetros para systeminformation
const par = {
  version: '*',
  system: '*',
  baseboard: '*',
  chassis: '*',
  os: '*',
  uuid: '*',
  versions: '*',
  cpu: '*',
  graphics: '*',
  networkInterfaces: '*',
  memLayout: '*',
  diskLayout: '*',
  audio: '*',
  bluetooth: '*',
  usb: '*',
  printer: '*',
  time: '*',
  node: '*',
  v8: '*',
  cpuCurrentSpeed: '*',
  currentLoad: '*',
  temp: '*',
  users: '*',
  battery: '*',
  mem: '*',
  fsSize: '*',
  inetLatency: '*',
  wifiNetworks: '*',
  networkStats: '*'
};

// Ejecuta un comando y devuelve una promesa con stdout
function execute(cmd) {
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      {
        maxBuffer: 1024 * 1024 * 10 // 10 MB de buffer por si hay muchas apps
      },
      (err, stdout, stderr) => {
        if (err) {
          console.error('STDERR:', stderr);
          return reject(err);
        }
        resolve(stdout);
      }
    );
  });
}

// Determina el comando y el parser adecuado según el sistema operativo
function getCommandAndParser() {
  const platform = os.platform(); // 'win32', 'darwin', 'linux', etc.

  // ---------- WINDOWS ----------
  if (platform === 'win32') {
    const cmd =
      'powershell -NoProfile -Command ' +
      "\"$regPaths = @(" +
        "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
        "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
        "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
        "'HKCU:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'" +
      ");" +
      "$regApps = Get-ItemProperty -Path $regPaths -ErrorAction SilentlyContinue | " +
      "  Where-Object { $_.DisplayName } | " +
      "  Select-Object @{Name='Name';Expression={$_.DisplayName}}," +
      "                @{Name='Version';Expression={$_.DisplayVersion}}," +
      "                Publisher, InstallLocation," +
      "                @{Name='Source';Expression={'win32-registry'}};" +
      "$storeApps = Get-AppxPackage | " +
      "  Select-Object @{Name='Name';Expression={$_.Name}}," +
      "                @{Name='Version';Expression={$_.Version}}," +
      "                Publisher, PackageFamilyName," +
      "                @{Name='Source';Expression={'ms-store'}};" +
      "$all = $regApps + $storeApps;" +
      "$all | ConvertTo-Json -Depth 4\"";

    const parser = (stdout) => {
      if (!stdout || !stdout.trim()) {
        return [];
      }

      let data;
      try {
        data = JSON.parse(stdout);
      } catch (e) {
        console.error('No se pudo parsear el JSON de PowerShell:', e.message);
        return [];
      }

      const arr = Array.isArray(data) ? data : (data ? [data] : []);

      return arr
        .map(app => ({
          name: app.Name || null,
          version: app.Version || null,
          source: app.Source || null,
          publisher: app.Publisher || null,
          installLocation: app.InstallLocation || null,
          packageFamilyName: app.PackageFamilyName || null
        }))
        .filter(app => app.name);
    };

    return { cmd, parser };
  }

  // ---------- macOS ----------
  if (platform === 'darwin') {
    const cmd = 'system_profiler SPApplicationsDataType -json';

    const parser = (stdout) => {
      const json = JSON.parse(stdout);
      const apps = json.SPApplicationsDataType || [];

      return apps
        .map(app => ({
          name: app._name || null,
          version: app.version || null,
          path: app.path || null,
          lastModified: app.lastModified || null
        }))
        .filter(app => app.name);
    };

    return { cmd, parser };
  }

  // ---------- LINUX ----------
  if (platform === 'linux') {
    const cmd = "bash -lc '" +
      "if command -v dpkg-query >/dev/null 2>&1; then " +
      "  dpkg-query -W -f=\"${binary:Package}\\t${Version}\\n\"; " +
      "elif command -v rpm >/dev/null 2>&1; then " +
      "  rpm -qa --qf \"%{NAME}\\t%{VERSION}-%{RELEASE}\\n\"; " +
      "else " +
      "  echo \"UNSUPPORTED\"; " +
      "fi'";

    const parser = (stdout) => {
      if (!stdout.trim() || stdout.startsWith('UNSUPPORTED')) {
        return [];
      }

      return stdout
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          const [name, version] = line.split('\t');
          return {
            name: name || null,
            version: version || null
          };
        });
    };

    return { cmd, parser };
  }

  throw new Error('Plataforma no soportada: ' + platform);
}

// Promesa para obtener BIOS vía WMI (solo Windows)
function collectBiosIfWindows() {
  if (os.platform() !== 'win32') {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    wmi.Query()
      .class('Win32_BIOS')
      .exec((err, bios) => {
        if (err) return reject(err);
        resolve(bios);
      });
  });
}

async function main() {
  // 1) Obtener lista de software instalado
  let apps = [];
  
  console.log('🔍 Obteniendo lista de software instalado ... '+ new Date());
  try {
    const { cmd, parser } = getCommandAndParser();
    const stdout = await execute(cmd);
    apps = parser(stdout);
  } catch (e) {
    console.error('Error obteniendo lista de software:', e.message);
  }

  // 2) Obtener información de sistema + BIOS (si aplica)
  const systemInfo = {};
  console.log('🔍 Obteniendo información del sistema ... '+ new Date());
  const [allData, bios] = await Promise.all([
    si.get(par),
    collectBiosIfWindows()
  ]);
  console.log('✅ Información del sistema obtenida ... '+ new Date());
  systemInfo.hardware = allData;
  if (bios) {
    systemInfo.hardware.bios = bios;
  }

  systemInfo.software = {
    count: apps.length,
    apps
  };
  const now = new Date();
  // 1) Siempre guardamos UTC ISO (recomendado)
  const collectedAtUtc = new Date().toISOString();

  // 2) Versión en horario de CDMX usando Intl (America/Mexico_City)
  const formatter = new Intl.DateTimeFormat('en-CA', { // en-CA da formato yyyy-mm-dd
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(now).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  // armamos algo tipo 2025-11-19T23:15:30 (hora local CDMX)
  const collectedAtLocal = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;

  // Opcional: metadata del agente
  systemInfo.agent = {
    collectedAtUtc,      // UTC ISO (2025-11-20T05:15:30.123Z)
    collectedAtLocal,    // Hora local CDMX (2025-11-19T23:15:30)
    timeZone: 'America/Mexico_City', // para que el backend sepa qué es
    host: os.hostname(),
    platform: os.platform(),
    release: os.release()
  };

  // 3) Guardar en JSON local
  console.log('💾 Guardando system-info.json localmente ... '+ new Date());
  const outputFile = path.join(app.getPath("userData"), "system-info.json");
  fs.writeFileSync(outputFile, JSON.stringify(systemInfo, null, 2));
  console.log('✅ System information saved to system-info.json ... '+ new Date());

  // 4) Enviar al servidor usando el objeto en memoria (no leemos el archivo)
  try {
    await uploadSystemInfo(systemInfo);
  } catch (err) {
    console.error('⚠️ Error subiendo la información:', err.message);
  }
}

main().catch((err) => {
  console.error('Error inesperado en index.js:', err.message);
  process.exit(1);
});

module.exports = { runInventory: main };