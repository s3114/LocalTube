const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const {
  getAugmentedPath,
  getPlatformToolRequirements,
  resolveToolRequirement,
} = require("../start-localtube");

test("start-localtube uses one launcher definition with platform-specific tool candidates", () => {
  const windowsTools = getPlatformToolRequirements("win32");
  const macTools = getPlatformToolRequirements("darwin");

  assert.deepEqual(windowsTools.find((tool) => tool.name === "yt-dlp").candidates, [
    "yt-dlp.exe",
    "yt-dlp",
  ]);
  assert.deepEqual(macTools.find((tool) => tool.name === "yt-dlp").candidates, ["yt-dlp"]);
  assert.deepEqual(macTools.find((tool) => tool.name === "ffmpeg").candidates, ["ffmpeg"]);
  assert.equal(macTools.some((tool) => tool.candidates.some((candidate) => candidate.endsWith(".exe"))), false);
});

test("start-localtube resolves a local platform-native command candidate", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "localtube-start-"));
  const localToolPath = path.join(tempDir, "sample-tool");
  await fs.writeFile(localToolPath, "stub", "utf8");

  const resolved = resolveToolRequirement(
    { candidates: ["sample-tool.exe", "sample-tool"] },
    tempDir,
    "darwin",
  );

  assert.equal(resolved, "sample-tool");
  await fs.rm(tempDir, { recursive: true, force: true });
});

test("start-localtube augments POSIX PATH with Homebrew locations", () => {
  const augmented = getAugmentedPath("darwin", "/custom/bin:/usr/bin");
  assert.equal(augmented.split(":").includes("/opt/homebrew/bin"), true);
  assert.equal(augmented.split(":").includes("/usr/local/bin"), true);
  assert.equal(augmented.startsWith("/opt/homebrew/bin:/usr/local/bin"), true);
  assert.equal(augmented.split(":").filter((entry) => entry === "/usr/bin").length, 1);
  assert.equal(augmented.split(":").includes("/custom/bin"), true);
  assert.equal(getAugmentedPath("win32", "C:\\Tools"), "C:\\Tools");
});
