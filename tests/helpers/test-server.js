const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { CONFIG_DEFAULTS } = require("../../server/config-store");

const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_PATH = path.join(ROOT, "config.json");

async function readSeedConfigText() {
  try {
    return await fs.readFile(CONFIG_PATH, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return `${JSON.stringify(CONFIG_DEFAULTS, null, 2)}\n`;
    }
    throw error;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((closeError) => {
        if (closeError) reject(closeError);
        else resolve(port);
      });
    });
  });
}

async function waitForServerReady(baseUrlArg, maxMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxMs) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 700);
      const response = await fetch(`${baseUrlArg}/ping`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) return true;
    } catch {
      // retry
    }
    await sleep(200);
  }
  return false;
}

function createTestServerContext() {
  let serverProcess = null;
  let baseUrl = "";
  let testConfigPath = "";
  let testPublicDir = "";
  let started = false;

  async function start() {
    if (started) return;
    started = true;

    const originalConfigText = await readSeedConfigText();
    const testPort = await getFreePort();
    baseUrl = `http://127.0.0.1:${testPort}`;
    testConfigPath = path.join(
      os.tmpdir(),
      `youtubedl-config-test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
    );
    testPublicDir = path.join(
      os.tmpdir(),
      `youtubedl-public-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    await fs.writeFile(testConfigPath, originalConfigText, "utf8");
    await fs.mkdir(testPublicDir, { recursive: true });

    serverProcess = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(testPort),
        YTDL_CONFIG_PATH: testConfigPath,
        YTDL_PUBLIC_DIR: testPublicDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const ready = await waitForServerReady(baseUrl, 10000);
    if (!ready) {
      throw new Error("Failed to start local test server.");
    }
  }

  async function stop() {
    if (!started) return;
    started = false;

    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
    }
    if (testConfigPath) {
      try {
        await fs.unlink(testConfigPath);
      } catch {
        // noop
      }
    }
    if (testPublicDir) {
      try {
        await fs.rm(testPublicDir, { recursive: true, force: true });
      } catch {
        // noop
      }
    }
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const body = await response.json();
    return { status: response.status, body };
  }

  return {
    start,
    stop,
    fetchJson,
    get baseUrl() {
      return baseUrl;
    },
  };
}

module.exports = {
  createTestServerContext,
};
