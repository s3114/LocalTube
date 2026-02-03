// メンバーバッチ保存.js（サイズ指定を除去して保存）

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BADGE_DIR = path.join("downloads", "メンバーバッチ");
const CHAT_FILE = process.argv[2];

if (!CHAT_FILE) {
  console.error("使用方法: node メンバーバッチ保存.js <chat.jsonのパス>");
  process.exit(1);
}

fs.mkdirSync(BADGE_DIR, { recursive: true });

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

async function downloadIfNotExists(url) {
  // ★★★ ここで正規化 ★★★
  const normalizedUrl = normalizeBadgeUrl(url);
  // ★★★★★★★★★★★★★

  const filename = urlToFilename(normalizedUrl);
  const filepath = path.join(BADGE_DIR, filename);

  if (fs.existsSync(filepath)) {
    return filepath;
  }

  console.log("Downloading:", normalizedUrl);

  try {
    const res = await fetch(normalizedUrl);
    if (!res.ok) {
      console.error(`Failed (${res.status}):`, normalizedUrl);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filepath, buffer);
    return filepath;
  } catch (e) {
    console.error("Error downloading:", normalizedUrl, e.message);
    return null;
  }
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
  const lines = fs.readFileSync(CHAT_FILE, "utf-8").split("\n");

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
