const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const BASE_DIR = __dirname;
const POSIX_PATH_ENTRIES = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
];

function getAugmentedPath(platform = process.platform, currentPath = process.env.PATH || "") {
  if (platform === "win32") return currentPath;

  const separator = ":";
  const entries = [
    ...POSIX_PATH_ENTRIES,
    ...String(currentPath || "").split(separator),
  ].filter(Boolean);
  return Array.from(new Set(entries)).join(separator);
}

function applyRuntimePath(platform = process.platform) {
  process.env.PATH = getAugmentedPath(platform, process.env.PATH);
  return process.env.PATH;
}

function formatCommandList(commands) {
  return commands.map((command) => `\`${command}\``).join(" / ");
}

function getPlatformToolRequirements(platform = process.platform) {
  if (platform === "win32") {
    return [
      {
        name: "yt-dlp",
        candidates: ["yt-dlp.exe", "yt-dlp"],
        installHint: "起動.bat を実行すると yt-dlp.exe を自動セットアップします。",
      },
      {
        name: "ffmpeg",
        candidates: ["ffmpeg.exe", "ffmpeg"],
        installHint: "起動.bat を実行すると ffmpeg.exe を自動セットアップします。",
      },
      {
        name: "AtomicParsley",
        candidates: ["AtomicParsley.exe", "atomicparsley.exe", "AtomicParsley"],
        installHint: "起動.bat を実行すると AtomicParsley.exe を自動セットアップします。",
      },
      {
        name: "Deno",
        candidates: ["deno.exe", "deno"],
        installHint: "起動.bat を実行すると deno.exe を自動セットアップします。",
      },
    ];
  }

  return [
    {
      name: "yt-dlp",
      candidates: ["yt-dlp"],
      installHint: "Homebrewを使う場合: brew install yt-dlp",
    },
    {
      name: "ffmpeg",
      candidates: ["ffmpeg"],
      installHint: "Homebrewを使う場合: brew install ffmpeg",
    },
    {
      name: "AtomicParsley",
      candidates: ["AtomicParsley", "atomicparsley"],
      installHint: "Homebrewを使う場合: brew install atomicparsley",
    },
    {
      name: "Deno",
      candidates: ["deno"],
      installHint: "Homebrewを使う場合: brew install deno",
    },
  ];
}

function localCandidateExists(baseDir, candidate) {
  if (!candidate || path.isAbsolute(candidate)) return false;
  return fs.existsSync(path.join(baseDir, candidate));
}

function commandExists(command, platform = process.platform) {
  if (!command) return false;
  const env = {
    ...process.env,
    PATH: getAugmentedPath(platform, process.env.PATH),
  };
  const result = platform === "win32"
    ? spawnSync("where", [command], { stdio: "ignore", windowsHide: true, env })
    : spawnSync("sh", ["-lc", `command -v ${JSON.stringify(command)}`], { stdio: "ignore", env });
  return result.status === 0;
}

function resolveToolRequirement(requirement, baseDir = BASE_DIR, platform = process.platform) {
  const candidates = Array.isArray(requirement?.candidates) ? requirement.candidates : [];
  const found = candidates.find(
    (candidate) => localCandidateExists(baseDir, candidate) || commandExists(candidate, platform),
  );
  return found || null;
}

function findMissingOptionalTools({ baseDir = BASE_DIR, platform = process.platform } = {}) {
  return getPlatformToolRequirements(platform)
    .map((requirement) => ({
      ...requirement,
      foundCommand: resolveToolRequirement(requirement, baseDir, platform),
    }))
    .filter((requirement) => !requirement.foundCommand);
}

function printOptionalToolWarnings(missingTools, platform = process.platform) {
  if (!missingTools.length) return;

  console.log("動画ダウンロード用の外部コマンドが不足しています:");
  for (const tool of missingTools) {
    console.log(`- ${tool.name}: ${formatCommandList(tool.candidates)} が見つかりません。`);
    console.log(`  ${tool.installHint}`);
  }

  if (platform !== "win32") {
    console.log("macOS/LinuxではWindows用の .exe / .dll は実行しません。");
    console.log("Homebrewを使う場合はまとめて次を実行できます: brew install yt-dlp ffmpeg atomicparsley deno");
  }
  console.log("動画を見るだけなら、このまま起動できます。\n");
}

function ensureNodeModules({ baseDir = BASE_DIR } = {}) {
  const nodeModulesPath = path.join(baseDir, "node_modules");
  if (fs.existsSync(nodeModulesPath)) return;

  console.log("依存パッケージをインストールしています...");
  const result = spawnSync("npm", ["install"], {
    cwd: baseDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: false,
    env: {
      ...process.env,
      PATH: getAugmentedPath(process.platform, process.env.PATH),
    },
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function startServer({ baseDir = BASE_DIR } = {}) {
  const serverPath = path.join(baseDir, "server.js");
  console.log("LocalTube を起動します: http://localhost:3000");
  const child = spawn(process.execPath, [serverPath], {
    cwd: baseDir,
    stdio: "inherit",
    windowsHide: false,
    env: {
      ...process.env,
      PATH: getAugmentedPath(process.platform, process.env.PATH),
    },
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code || 0);
  });
}

function main() {
  applyRuntimePath();
  const missingTools = findMissingOptionalTools();
  printOptionalToolWarnings(missingTools);
  ensureNodeModules();
  startServer();
}

if (require.main === module) {
  main();
}

module.exports = {
  applyRuntimePath,
  commandExists,
  findMissingOptionalTools,
  formatCommandList,
  getAugmentedPath,
  getPlatformToolRequirements,
  localCandidateExists,
  printOptionalToolWarnings,
  resolveToolRequirement,
};
