// メンバー絵文字保存.js

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const EMOJI_DIR = path.join("downloads", "メンバー絵文字");
const CHAT_FILE = process.argv[2];

if (!CHAT_FILE) {
  console.error("使用方法: node メンバー絵文字保存.js <chat.jsonのパス>");
  process.exit(1);
}

fs.mkdirSync(EMOJI_DIR, { recursive: true });

// ===== URL正規化（サイズ指定を削除）=====
function normalizeEmojiUrl(url) {
  // "=w48-h48-c-k-nd" や "=w24-h24-c-k-nd" などを削除
  return url.replace(/=w\d+-h\d+[-a-z0-9]*/i, "");
}

function urlToFilename(url) {
  const hash = crypto.createHash("sha256").update(url).digest("hex");
  return `${hash}.png`;
}

async function downloadIfNotExists(url) {
  const normalizedUrl = normalizeEmojiUrl(url);
  const filename = urlToFilename(normalizedUrl);
  const filepath = path.join(EMOJI_DIR, filename);

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

// ===== 絵文字URLを再帰的に抽出 =====
function extractEmojiUrls(obj, results = new Set()) {
  if (!obj || typeof obj !== "object") return results;

  // パターンに一致する場所をチェック
  if (obj.image && Array.isArray(obj.image.thumbnails)) {
    for (const t of obj.image.thumbnails) {
      if (typeof t.url === "string") {
        results.add(t.url);
      }
    }
  }

  // 再帰探索
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === "object") {
      extractEmojiUrls(value, results);
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

    const urls = extractEmojiUrls(data);

    for (const url of urls) {
      await downloadIfNotExists(url);
    }
  }

  console.log("Done.");
}

main();
