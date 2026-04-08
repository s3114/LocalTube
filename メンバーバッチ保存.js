// ======== ★ CommonJS 版（require）★ ========
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Node 18+ の標準 fetch を使う（node-fetch は不要）
const fetch = global.fetch;

// ======== ★ 入力：ジョブフォルダ or live_chat.json そのもの ★ ========
const inputPath = process.argv[2];

if (!inputPath) {
  console.error(
    "使用方法: node メンバーバッチ保存.js <syorimachi_folder/job_xxx | *.live_chat.json>",
  );
  process.exit(1);
}
const resolvedInputPath = path.resolve(inputPath);
const LIVE_CHAT_JSON_PATTERN = /\.live_chat(?:\.[^.]+)?\.json$/i;
let chatJsonPath = null;

if (fs.existsSync(resolvedInputPath) && fs.statSync(resolvedInputPath).isFile()) {
  if (!LIVE_CHAT_JSON_PATTERN.test(path.basename(resolvedInputPath))) {
    console.error("live_chat.json ではありません:", resolvedInputPath);
    process.exit(1);
  }
  chatJsonPath = resolvedInputPath;
} else if (
  fs.existsSync(resolvedInputPath) &&
  fs.statSync(resolvedInputPath).isDirectory()
) {
  const files = fs.readdirSync(resolvedInputPath);
  const chatFile = files.find((f) => LIVE_CHAT_JSON_PATTERN.test(f));
  if (!chatFile) {
    console.error("live_chat.json が見つかりません:", resolvedInputPath);
    process.exit(0);
  }
  chatJsonPath = path.join(resolvedInputPath, chatFile);
} else {
  console.error("入力が見つかりません:", resolvedInputPath);
  process.exit(1);
}

// ======== ★ 出力フォルダ ★ ========
const OUTPUT_DIR = path.join(process.cwd(), "downloads", "メンバーバッチ");
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log("入力（chat）:", chatJsonPath);
console.log("出力先:", OUTPUT_DIR);

// ★★★ 追加：URL正規化（サイズ指定を削除）★★★
function normalizeBadgeUrl(url) {
  // "=s32-c-k" や "=s16-c-k" の部分を削除
  return url.replace(/=s\d+[-a-z0-9]*/i, "");
}
// ★★★★★★★★★★★★★★★★★★★★★★★★★

function urlToFilename(url) {
  const hash = crypto.createHash("sha256").update(url).digest("hex");
  return `${hash}.png`;
}

const attemptedDownloads = new Map();

async function downloadIfNotExists(url) {
  const normalizedUrl = normalizeBadgeUrl(url);
  const filename = urlToFilename(normalizedUrl);
  const filepath = path.join(OUTPUT_DIR, filename);
  const candidateUrls =
    normalizedUrl && normalizedUrl !== url ? [url, normalizedUrl] : [url];

  if (url.includes("fonts.gstatic.com")) {
    console.log("Skip (Unicode emoji):", url);
    return;
  }

  if (fs.existsSync(filepath)) {
    return filepath;
  }

  if (attemptedDownloads.has(filename)) {
    return attemptedDownloads.get(filename);
  }

  attemptedDownloads.set(filename, null);

  for (const candidateUrl of candidateUrls) {
    console.log("Downloading:", candidateUrl);

    try {
      const res = await fetch(candidateUrl);
      if (!res.ok) {
        console.error(`Failed (${res.status}):`, candidateUrl);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(filepath, buffer);
      attemptedDownloads.set(filename, filepath);
      return filepath;
    } catch (e) {
      console.error("Error downloading:", candidateUrl, e.message);
    }
  }

  return null;
}

function extract32pxBadgeUrls(obj, results = new Set()) {
  if (!obj || typeof obj !== "object") return results;

  if (obj.customThumbnail && Array.isArray(obj.customThumbnail.thumbnails)) {
    for (const t of obj.customThumbnail.thumbnails) {
      if (t.width === 32 && typeof t.url === "string") {
        results.add(t.url);
      }
    }
  }

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "object") {
      extract32pxBadgeUrls(value, results);
    }
  }

  return results;
}

async function main() {
  const lines = fs.readFileSync(chatJsonPath, "utf-8").split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }

    const urls = extract32pxBadgeUrls(data);

    for (const url of urls) {
      await downloadIfNotExists(url);
    }
  }

  console.log("Done.");
}

main();
