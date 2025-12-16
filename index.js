const si = require("systeminformation");
const wmi = require("node-wmi");
const { exec } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { uploadSystemInfo } = require("./upload-system-info");

// =======================
// PARÁMETROS SYSTEMINFORMATION
// =======================

const par = {
  version: "*",
  system: "*",
  baseboard: "*",
  chassis: "*",
  os: "*",
  uuid: "*",
  versions: "*",
  cpu: "*",
  graphics: "*",
  networkInterfaces: "*",
  memLayout: "*",
  diskLayout: "*",
  audio: "*",
  bluetooth: "*",
  usb: "*",
  printer: "*",
  time: "*",
  node: "*",
  v8: "*",
  cpuCurrentSpeed: "*",
  currentLoad: "*",
  temp: "*",
  users: "*",
  battery: "*",
  mem: "*",
  fsSize: "*",
  inetLatency: "*",
  wifiNetworks: "*",
  networkStats: "*"
};

// =======================
// UTILS
// =======================

function execute(cmd) {
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      { maxBuffer: 1024 * 1024 * 10 },
      (err, stdout, stderr) => {
        if (err) {
          console.error("STDERR:", stderr);
          return reject(err);
        }
        resolve(stdout);
      }
    );
  });
}

// =======================
// SOFTWARE INVENTORY
// =======================

function getCommandAndParser() {
  const platform = os.platform();

  // ---------- WINDOWS ----------
  if (platform === "win32") {
    const cmd =
      'powershell -NoProfile -Command ' +
      "\"$regPaths = @(" +
      "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
      "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
      "'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'," +
      "'HKCU:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'" +
      ");" +
      "$regApps = Get-ItemProperty -Path $regPaths -ErrorAction SilentlyContinue | " +
      "Where-Object { $_.DisplayName } | " +
      "Select-Object @{Name='Name';Expression={$_.DisplayName}}," +
      "@{Name='Version';Expression={$_.DisplayVersion}}," +
      "Publisher, InstallLocation," +
      "@{Name='Source';Expression={'win32-registry'}};" +
      "$storeApps = Get-AppxPackage | " +
      "Select-Object @{Name='Name';Expression={$_.Name}}," +
      "@{Name='Version';Expression={$_.Version}}," +
      "Publisher, PackageFamilyName," +
      "@{Name='Source';Expression={'ms-store'}};" +
      "$all = $regApps + $storeApps;" +
      "$all | ConvertTo-Json -Depth 4\"";

    const parser = (stdout) => {
      if (!stdout || !stdout.trim()) return [];
      let data;
      try {
        data = JSON.parse(stdout);
      } catch {
        return [];
      }

      const arr = Array.isArray(data) ? data : [data];
      return arr
        .map(app => ({
          name: app.Name || null,
          version: app.Version || null,
          source: app.Source || null,
          publisher: app.Publisher || null,
          installLocation: app.InstallLocation || null,
          packageFamilyName: app.PackageFamilyName || null
        }))
        .filter(a => a.name);
    };

    return { cmd, parser };
  }

  // ---------- macOS ----------
  if (platform === "darwin") {
    const cmd = "system_profiler SPApplicationsDataType -json";

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
        .filter(a => a.name);
    };

    return { cmd, parser };
  }

  // ---------- LINUX ----------
  if (platform === "linux") {
    const cmd =
      "bash -lc 'if command -v dpkg-query >/dev/null 2>&1; then " +
      "dpkg-query -W -f=\"${binary:Package}\\t${Version}\\n\"; " +
      "elif command -v rpm >/dev/null 2>&1; then " +
      "rpm -qa --qf \"%{NAME}\\t%{VERSION}-%{RELEASE}\\n\"; " +
      "else echo \"UNSUPPORTED\"; fi'";

    const parser = (stdout) =>
      stdout
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => {
          const [name, version] = l.split("\t");
          return { name, version };
        });

    return { cmd, parser };
  }

  throw new Error("Unsupported platform");
}

// =======================
// BIOS (WINDOWS ONLY)
// =======================

function collectBiosIfWindows() {
  if (os.platform() !== "win32") return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    wmi.Query()
      .class("Win32_BIOS")
      .exec((err, bios) => {
        if (err) return reject(err);
        resolve(bios);
      });
  });
}

// =======================
// MAIN INVENTORY
// =======================

async function main() {
  const userDataDir = app.getPath("userData");
  const outputFile = path.join(userDataDir, "system-info.json");

  // 1️⃣ Software
  let apps = [];
  try {
    const { cmd, parser } = getCommandAndParser();
    const stdout = await execute(cmd);
    apps = parser(stdout);
  } catch (e) {
    console.error("Software inventory error:", e.message);
  }

  // 2️⃣ Hardware
  const [hardware, bios] = await Promise.all([
    si.get(par),
    collectBiosIfWindows()
  ]);

  if (bios) hardware.bios = bios;

  // 3️⃣ Metadata
  const now = new Date();
  const collectedAtUtc = now.toISOString();

  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(now).reduce((a, p) => {
    a[p.type] = p.value;
    return a;
  }, {});

  const collectedAtLocal =
    `${parts.year}-${parts.month}-${parts.day}T` +
    `${parts.hour}:${parts.minute}:${parts.second}`;

  const systemInfo = {
    agent: {
      collectedAtUtc,
      collectedAtLocal,
      timeZone: "America/Mexico_City",
      host: os.hostname(),
      platform: os.platform(),
      release: os.release()
    },
    hardware,
    software: {
      count: apps.length,
      apps
    }
  };

  // 4️⃣ Save locally
  fs.writeFileSync(outputFile, JSON.stringify(systemInfo, null, 2));

  // 5️⃣ Upload
  try {
    await uploadSystemInfo(systemInfo);
  } catch (err) {
    console.error("Upload error:", err.message);
  }
}

module.exports = { runInventory: main };
