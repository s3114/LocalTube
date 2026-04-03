const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const { getLogEntries } = require("../services/log-stream-service");
const { getLocalTubeErrorHints } = require("../../shared/error-hints");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatIsoToLocalText(isoText) {
  if (!isoText) return "不明";
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) return String(isoText);
  const yyyy = date.getFullYear();
  const MM = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

function buildJapanTimestampForFilename(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const pick = (type) =>
    parts.find((part) => part.type === type)?.value || "00";
  const yyyy = pick("year");
  const MM = pick("month");
  const dd = pick("day");
  const hh = pick("hour");
  const mm = pick("minute");
  const ss = pick("second");
  return `${yyyy}${MM}${dd}-${hh}${mm}${ss}`;
}

function formatDurationFromMs(ms) {
  const totalSec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return `${hours}時間 ${minutes}分 ${seconds}秒`;
}

function formatBytesToReadable(bytes) {
  const num = Number(bytes || 0);
  if (!Number.isFinite(num) || num < 0) return "不明";
  const gb = 1024 ** 3;
  const mb = 1024 ** 2;
  if (num >= gb) return `${(num / gb).toFixed(1)} GB`;
  if (num >= mb) return `${(num / mb).toFixed(1)} MB`;
  return `${num} bytes`;
}

function maskPersonalPath(value) {
  const text = String(value || "");
  return text.replace(/^([A-Za-z]:\\Users\\)([^\\]+)(\\?)/i, "$1PCNAME$3");
}

function detectBrowserName(userAgent, brands = []) {
  const ua = String(userAgent || "");
  const normalizedBrands = Array.isArray(brands)
    ? brands.map((brand) => String(brand || "").toLowerCase())
    : [];

  const hasBrand = (needle) =>
    normalizedBrands.some((brand) => brand.includes(String(needle).toLowerCase()));

  if (hasBrand("Microsoft Edge") || /edg\//i.test(ua)) return "Edge";
  if (hasBrand("Opera") || /(?:opr|opera)\//i.test(ua)) return "Opera";
  if (hasBrand("Vivaldi") || /vivaldi/i.test(ua)) return "Vivaldi";
  if (hasBrand("Brave") || /brave/i.test(ua)) return "Brave";
  if (hasBrand("Arc") || /arc\//i.test(ua)) return "Arc";
  if (hasBrand("Samsung Internet") || /samsungbrowser\//i.test(ua)) {
    return "Samsung Internet";
  }
  if (hasBrand("DuckDuckGo") || /duckduckgo/i.test(ua)) return "DuckDuckGo";
  if (hasBrand("NAVER Whale") || /whale\//i.test(ua)) return "Whale";
  if (hasBrand("Yandex") || /yabrowser\//i.test(ua)) return "Yandex";
  if (hasBrand("Firefox") || /firefox\//i.test(ua)) return "Firefox";
  if (/msie|trident/i.test(ua)) return "Internet Explorer";
  if (hasBrand("Chromium") || /chromium\//i.test(ua)) return "Chromium";
  if (hasBrand("Google Chrome") || /chrome\//i.test(ua)) return "Chrome";
  if (hasBrand("Safari") || (/safari\//i.test(ua) && !/chrome|chromium|edg|opr/i.test(ua))) {
    return "Safari";
  }
  return "不明";
}

function readWindowsRegistryValue(valueName) {
  const result = spawnSync(
    "reg",
    [
      "query",
      "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
      "/v",
      valueName,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      shell: false,
    },
  );

  if (result.error || result.status !== 0) return "";
  const output = String(result.stdout || "");
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.toLowerCase().startsWith(valueName.toLowerCase()));
  if (!line) return "";
  const parts = line.split(/\s{2,}/).filter(Boolean);
  return parts[parts.length - 1] || "";
}

function getWindowsRegistryInfo() {
  const productName = readWindowsRegistryValue("ProductName");
  const displayVersion = readWindowsRegistryValue("DisplayVersion");
  const releaseId = readWindowsRegistryValue("ReleaseId");
  const currentBuild = readWindowsRegistryValue("CurrentBuild");
  const currentBuildNumber = readWindowsRegistryValue("CurrentBuildNumber");
  const ubr = readWindowsRegistryValue("UBR");

  return {
    productName,
    displayVersion,
    releaseId,
    currentBuild: currentBuild || currentBuildNumber,
    ubr,
  };
}

function normalizeWindowsProductName(productName, releaseText) {
  const normalizedProductName = String(productName || "").trim();
  const release = String(releaseText || os.release());
  const build = Number.parseInt(release.split(".")[2] || "0", 10);

  if (build >= 22000 && /^Windows 10\b/i.test(normalizedProductName)) {
    return normalizedProductName.replace(/^Windows 10\b/i, "Windows 11");
  }

  return normalizedProductName;
}

function detectWindowsDisplayName() {
  if (process.platform === "win32") {
    const registryInfo = getWindowsRegistryInfo();
    const productName = normalizeWindowsProductName(
      registryInfo.productName,
      os.release(),
    );
    const displayVersion = String(
      registryInfo.displayVersion || registryInfo.releaseId || "",
    ).trim();

    if (productName && displayVersion) {
      return `${productName} ${displayVersion}`;
    }
    if (productName) {
      return productName;
    }
  }

  const release = os.release();
  const [major, minor, buildText] = String(release).split(".");
  const build = Number.parseInt(buildText || "0", 10);

  if (major === "10" && minor === "0") {
    if (build >= 26100) return "Windows11 24H2以降";
    if (build >= 22631) return "Windows11 23H2";
    if (build >= 22621) return "Windows11 22H2";
    if (build >= 22000) return "Windows11 21H2";
    if (build >= 19045) return "Windows10 22H2";
    if (build >= 19044) return "Windows10 21H2";
    if (build >= 19043) return "Windows10 21H1";
    if (build >= 19042) return "Windows10 20H2";
    if (build >= 19041) return "Windows10 2004";
    if (build >= 18363) return "Windows10 1909";
    if (build >= 18362) return "Windows10 1903";
    if (build >= 17763) return "Windows10 1809";
    if (build >= 17134) return "Windows10 1803";
    if (build >= 16299) return "Windows10 1709";
    if (build >= 15063) return "Windows10 1703";
    if (build >= 14393) return "Windows10 1607";
    if (build >= 10586) return "Windows10 1511";
    if (build >= 10240) return "Windows10 1507";
    return "Windows10";
  }

  if (major === "6" && minor === "3") return "Windows8.1";
  if (major === "6" && minor === "2") return "Windows8";
  if (major === "6" && minor === "1") return "Windows7";
  if (major === "6" && minor === "0") return "WindowsVista";
  if (major === "5" && minor === "1") return "WindowsXP";

  return `${os.type()} ${release}`;
}

function readStorageInfo(baseDir) {
  if (process.platform !== "win32") {
    return {
      display: "不明",
      raw: "",
      totalBytes: 0,
      freeBytes: 0,
    };
  }

  const root = path.parse(baseDir).root;
  const deviceId = root.replace(/[\\\/]+$/, "");
  if (!deviceId) {
    return {
      display: "不明",
      raw: "",
      totalBytes: 0,
      freeBytes: 0,
    };
  }

  const command =
    `$disk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${deviceId}'"; ` +
    `if ($disk) { $disk | Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress }`;
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 4000,
      shell: false,
    },
  );

  if (result.error || result.status !== 0) {
    return {
      display: deviceId,
      raw: "",
      totalBytes: 0,
      freeBytes: 0,
    };
  }

  try {
    const parsed = JSON.parse(String(result.stdout || "").trim());
    const total = Number(parsed.Size || 0);
    const free = Number(parsed.FreeSpace || 0);
    const used = Math.max(0, total - free);
    const label = parsed.VolumeName
      ? `${parsed.DeviceID} (${parsed.VolumeName})`
      : parsed.DeviceID || deviceId;
    return {
      display: `${label} 使用 ${formatBytesToReadable(used)} / 全体 ${formatBytesToReadable(total)} / 空き ${formatBytesToReadable(free)}`,
      raw: `${label}`,
      totalBytes: total,
      freeBytes: free,
    };
  } catch {
    return {
      display: deviceId,
      raw: "",
      totalBytes: 0,
      freeBytes: 0,
    };
  }
}

function readVersionText(baseDir) {
  try {
    return fs.readFileSync(path.join(baseDir, "version.txt"), "utf8").trim();
  } catch {
    return "不明";
  }
}

function readRootDirectorySnapshot(baseDir) {
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const directories = [];
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      directories.push({ name: entry.name });
      continue;
    }

    const stat = fs.statSync(fullPath);
    files.push({
      name: entry.name,
      size: stat.size,
    });
  }

  directories.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  files.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return { directories, files };
}

function readCommandVersion(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 5000,
    shell: false,
  });

  if (result.error) {
    return {
      ok: false,
      command,
      output: result.error.message,
    };
  }

  const combined = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  if (result.status !== 0) {
    return {
      ok: false,
      command,
      output: combined || `終了コード ${result.status}`,
    };
  }

  const firstLine = combined.split(/\r?\n/).find(Boolean) || "";
  return {
    ok: true,
    command,
    output: firstLine,
  };
}

function resolveExistingToolPath(baseDir, candidates, allowPathLookup = false) {
  for (const candidate of candidates) {
    const fullPath = path.join(baseDir, candidate);
    if (fs.existsSync(fullPath)) return fullPath;
  }
  if (!allowPathLookup) return null;
  return candidates[candidates.length - 1] || null;
}

function readToolVersions(baseDir) {
  const ytDlpPath = resolveExistingToolPath(baseDir, ["yt-dlp.exe"]);
  const ffmpegPath = resolveExistingToolPath(baseDir, ["ffmpeg.exe"]);
  const denoPath = resolveExistingToolPath(baseDir, ["deno.exe", "deno"], true);
  const atomicParsleyPath = resolveExistingToolPath(
    baseDir,
    ["AtomicParsley.exe", "atomicparsley.exe", "AtomicParsley"],
    true,
  );

  return {
    ytDlp: ytDlpPath
      ? readCommandVersion(ytDlpPath, ["--version"])
      : { ok: false, output: "見つかりません" },
    ffmpeg: ffmpegPath
      ? readCommandVersion(ffmpegPath, ["-version"])
      : { ok: false, output: "見つかりません" },
    deno: denoPath
      ? readCommandVersion(denoPath, ["--version"])
      : { ok: false, output: "見つかりません" },
    atomicParsley: atomicParsleyPath
      ? readCommandVersion(atomicParsleyPath, ["-v"])
      : { ok: false, output: "見つかりません" },
  };
}

function buildHtmlList(items) {
  return `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function buildBoolStatusLabel(value) {
  if (value === true) return '<span class="value-enabled">有効</span>';
  if (value === false) return '<span class="value-disabled">無効</span>';
  return escapeHtml(String(value ?? "不明"));
}

function buildKeyValueRows(rows) {
  return rows
    .map(
      (row) => `
        <div class="kv-row">
          <div class="kv-key">${escapeHtml(row.key)}</div>
          <div class="kv-sep">:</div>
          <div class="kv-value">${row.value}</div>
        </div>
      `,
    )
    .join("");
}

function buildSettingsRows(settings, client) {
  const downloadSettings = client?.downloadSettings || {};
  const cookieInfo = client?.cookieInfo || {};
  const cookieModeLabelMap = {
    firefox: "Firefox 自動連携",
    manual: "手動選択",
    none: "未設定",
  };

  return [
    {
      key: "画質",
      value: escapeHtml(
        downloadSettings.formatText || downloadSettings.formatValue || "不明",
      ),
    },
    {
      key: "保存先",
      value: escapeHtml(downloadSettings.savePath || "既定値"),
    },
    {
      key: "履歴保存",
      value: buildBoolStatusLabel(downloadSettings.saveHistory),
    },
    {
      key: "サムネイル取得",
      value: buildBoolStatusLabel(downloadSettings.downloadThumb),
    },
    {
      key: "サムネイル埋め込み",
      value: buildBoolStatusLabel(downloadSettings.embedThumbnail),
    },
    {
      key: "メタデータ埋め込み",
      value: buildBoolStatusLabel(downloadSettings.addMetadata),
    },
    {
      key: "再エンコード実行",
      value: buildBoolStatusLabel(downloadSettings.remuxVideo),
    },
    {
      key: "静的画質選択",
      value: buildBoolStatusLabel(downloadSettings.staticFormat),
    },
    {
      key: "IPv4 強制",
      value: buildBoolStatusLabel(downloadSettings.forceIpv4),
    },
    {
      key: "DRM 保護回避",
      value: buildBoolStatusLabel(downloadSettings.drmProtect),
    },
    {
      key: "コメント取得",
      value: buildBoolStatusLabel(downloadSettings.downloadComments),
    },
    {
      key: "チャット取得",
      value: buildBoolStatusLabel(downloadSettings.downloadChat),
    },
    {
      key: "動画取得",
      value: buildBoolStatusLabel(downloadSettings.downloadVideo),
    },
    {
      key: "同時ダウンロード数",
      value: escapeHtml(downloadSettings.parallelDownloads || "不明"),
    },
    {
      key: "同時フラグメント数",
      value: escapeHtml(downloadSettings.concurrentFragments || "不明"),
    },
    {
      key: "yt-dlp カスタムコマンド",
      value: settings.ytDlpCustomCommand
        ? "設定あり"
        : "未設定",
    },
    {
      key: "Cookie 取得方法",
      value:
        cookieModeLabelMap[cookieInfo.mode] ||
        escapeHtml(cookieInfo.mode || "不明"),
    },
    {
      key: "Cookie 取得時刻",
      value: escapeHtml(
        cookieInfo.updatedAtLocal ||
          formatIsoToLocalText(cookieInfo.updatedAt) ||
          "不明",
      ),
    },
  ];
}

function buildRootFilesHtml(files) {
  return buildHtmlList(files.map((file) => escapeHtml(file.name)));
}

function buildToolVersionsRows(toolVersions) {
  return [
    { key: "yt-dlp", value: escapeHtml(toolVersions.ytDlp.output) },
    { key: "ffmpeg", value: escapeHtml(toolVersions.ffmpeg.output) },
    { key: "deno", value: escapeHtml(toolVersions.deno.output) },
    {
      key: "AtomicParsley",
      value: escapeHtml(toolVersions.atomicParsley.output),
    },
  ];
}

function buildWarnLogsHtml(entries) {
  if (!entries.length) {
    return "<p>WARN / ERROR ログはありません。</p>";
  }

  return entries
    .map(
      (entry) => `
        <div class="log-card">
          <div class="log-meta">${escapeHtml(entry.timestamp)} [${escapeHtml(entry.scope)}]</div>
          <pre>${escapeHtml(entry.message)}</pre>
        </div>
      `,
    )
    .join("");
}

function buildFailedJobsHtml(jobHistory) {
  const failedJobs = Array.from(jobHistory.values()).filter(
    (job) => job.status === "error",
  );
  if (!failedJobs.length) {
    return "<p>失敗した動画はありません。</p>";
  }

  return failedJobs
    .map((job) => {
      const errorText = String(job.progress?.eta || "不明");
      const hints = getLocalTubeErrorHints(errorText);
      const hintHtml = hints.length
        ? `<div><strong>案内:</strong><ul>${hints
            .map((hint) => `<li>${escapeHtml(hint)}</li>`)
            .join("")}</ul></div>`
        : "";
      return `
        <div class="log-card">
          <div><strong>URL:</strong> ${escapeHtml(job.url || "不明")}</div>
          <div><strong>LocalTube エラー:</strong> ${escapeHtml(errorText)}</div>
          <div><strong>ジョブID:</strong> ${escapeHtml(job.id || "")}</div>
          ${hintHtml}
        </div>
      `;
    })
    .join("");
}

function buildReportHtml({
  baseDir,
  serverStartTime,
  settings,
  client,
  jobHistory,
}) {
  const now = new Date();
  const warnLogs = getLogEntries({ sinceId: 0, limit: 2000 }).filter(
    (entry) => ["warn", "error"].includes(String(entry.level)),
  );
  const rootSnapshot = readRootDirectorySnapshot(baseDir);
  const toolVersions = readToolVersions(baseDir);
  const startupAt = new Date(serverStartTime);
  const downloadSettingsRows = buildSettingsRows(settings, client);
  const browserName = detectBrowserName(
    client?.browserUserAgent,
    client?.browserBrands,
  );
  const browserUserAgent = client?.browserUserAgent || "不明";
  const osDisplay = detectWindowsDisplayName();
  const osRaw = `${os.type()} ${os.release()} (${os.arch()})`;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpuList = os.cpus() || [];
  const firstCpu = cpuList[0];
  const cpuDisplay = firstCpu
    ? `${firstCpu.model} / ${cpuList.length} logical cores`
    : "不明";
  const storageInfo = readStorageInfo(baseDir);

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>LocalTube Report</title>
  <style>
    body { font-family: "Segoe UI", sans-serif; background: #111; color: #eee; margin: 0; padding: 24px; line-height: 1.6; }
    h1, h2, h3, h4 { margin: 0 0 12px; }
    h1 { font-size: 28px; }
    h2 { margin-top: 32px; border-bottom: 1px solid #333; padding-bottom: 8px; }
    section { margin-bottom: 24px; }
    .muted { color: #aaa; }
    .card, .log-card, .file-card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 16px; margin-bottom: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
    pre { white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere; background: #0c0c0c; padding: 12px; border-radius: 8px; border: 1px solid #222; }
    ul { margin: 0; padding-left: 20px; }
    .file-meta, .log-meta { color: #9ab; font-size: 12px; margin-bottom: 8px; }
    .tag { display: inline-block; background: #222; border: 1px solid #444; border-radius: 999px; padding: 4px 10px; margin-right: 8px; font-size: 12px; }
    .kv-table { display: grid; gap: 8px; }
    .kv-row { display: grid; grid-template-columns: 220px 18px minmax(0, 1fr); align-items: start; }
    .kv-key { color: #ddd; }
    .kv-sep { color: #888; text-align: center; }
    .kv-value { color: #f1f1f1; min-width: 0; }
    .value-enabled { color: #4caf50; font-weight: 600; }
    .value-disabled { color: #ff6b6b; font-weight: 600; }
    .sub-line { display: block; color: #8f9ba8; font-size: 12px; margin-top: 3px; }
  </style>
</head>
<body>
  <h1>LocalTube レポート</h1>
  <p class="muted">生成時刻: ${escapeHtml(formatIsoToLocalText(now.toISOString()))}</p>
  <p class="muted">アプリのパス: ${escapeHtml(maskPersonalPath(baseDir))}</p>

  <h2>1. 実行環境</h2>
  <div class="grid">
    <div class="card">
      <h3>アプリ</h3>
      <div class="kv-table">
        ${buildKeyValueRows([
          {
            key: "LocalTube バージョン",
            value: escapeHtml(readVersionText(baseDir)),
          },
          {
            key: "Node.js",
            value: escapeHtml(process.version),
          },
          {
            key: "ブラウザ",
            value: `${escapeHtml(browserName)}<span class="sub-line">${escapeHtml(browserUserAgent)}</span>`,
          },
          {
            key: "サーバー起動時刻",
            value: escapeHtml(formatIsoToLocalText(startupAt.toISOString())),
          },
          {
            key: "稼働時間",
            value: escapeHtml(
              formatDurationFromMs(now.getTime() - serverStartTime),
            ),
          },
        ])}
      </div>
    </div>
    <div class="card">
      <h3>システム</h3>
      <div class="kv-table">
        ${buildKeyValueRows([
          {
            key: "OS",
            value: `${escapeHtml(osDisplay)}<span class="sub-line">${escapeHtml(osRaw)}</span>`,
          },
          {
            key: "メモリ",
            value: `${escapeHtml(formatBytesToReadable(totalMem))}`,
          },
          {
            key: "CPU",
            value: escapeHtml(cpuDisplay),
          },
          {
            key: "ストレージ",
            value: `${escapeHtml(
              storageInfo.raw || "不明",
            )}<span class="sub-line">空き: ${escapeHtml(
              formatBytesToReadable(storageInfo.freeBytes),
            )} / 全体: ${escapeHtml(
              formatBytesToReadable(storageInfo.totalBytes),
            )}</span>`,
          },
          {
            key: "ブラウザ",
            value: `${escapeHtml(browserName)}<span class="sub-line">${escapeHtml(browserUserAgent)}</span>`,
          },
        ])}
      </div>
    </div>
  </div>

  <h2>2. 設定情報</h2>
  <div class="card">
    <div class="kv-table">
      ${buildKeyValueRows(downloadSettingsRows)}
    </div>
  </div>

  <h2>3. ツールバージョン</h2>
  <div class="card">
    <div class="kv-table">
      ${buildKeyValueRows(buildToolVersionsRows(toolVersions))}
    </div>
  </div>

  <h2>4. フォルダ内部情報</h2>
  <div class="grid">
    <div class="card">
      <h3>フォルダ: ${rootSnapshot.directories.length}件</h3>
      ${buildHtmlList(rootSnapshot.directories.map((item) => escapeHtml(item.name)))}
    </div>
    <div class="card">
      <h3>ファイル: ${rootSnapshot.files.length}件</h3>
      ${buildRootFilesHtml(rootSnapshot.files)}
    </div>
  </div>

  <h2>5. エラー追跡情報</h2>
  <section>
    <h3>WARN / ERROR ログ</h3>
    ${buildWarnLogsHtml(warnLogs)}
  </section>
  <section>
    <h3>失敗した動画と LocalTube 側のエラー</h3>
    ${buildFailedJobsHtml(jobHistory)}
  </section>
</body>
</html>`;
}

function registerReportRoutes(app, deps) {
  const { baseDir, apiError, loadConfig, jobHistory, serverStartTime } = deps;

  app.post("/api/report/download", async (req, res) => {
    try {
      const settings = await loadConfig();
      const client = req.body && typeof req.body === "object" ? req.body : {};
      const html = buildReportHtml({
        baseDir,
        serverStartTime,
        settings,
        client,
        jobHistory,
      });
      const timestamp = buildJapanTimestampForFilename(new Date());
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="localtube-report-${timestamp}.html"`,
      );
      res.send(html);
    } catch (error) {
      apiError(res, 500, "レポート生成に失敗しました。", {
        detail: error.message,
      });
    }
  });
}

module.exports = {
  registerReportRoutes,
};
