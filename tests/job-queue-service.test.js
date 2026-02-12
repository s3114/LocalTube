const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

const { createJobQueueService } = require("../server/services/job-queue-service");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("job-queue-service processes a queued job once and sorts extra files", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ytdl-queue-test-"));
  const pendingChatDir = path.join(tempDir, "pending");
  const commentsDir = path.join(tempDir, "comments");
  const liveChatDir = path.join(tempDir, "live");
  const subtitleDir = path.join(tempDir, "subtitle");
  await fsp.mkdir(pendingChatDir, { recursive: true });
  await fsp.mkdir(commentsDir, { recursive: true });
  await fsp.mkdir(liveChatDir, { recursive: true });
  await fsp.mkdir(subtitleDir, { recursive: true });

  const calls = [];
  const service = createJobQueueService({
    rootDir: tempDir,
    pendingChatDir,
    commentsDir,
    liveChatDir,
    subtitleDir,
    runScript: async (command) => {
      calls.push(command);
    },
    enableWatch: false,
  });

  const jobDir = path.join(pendingChatDir, "job_1");
  await fsp.mkdir(jobDir, { recursive: true });
  await fsp.writeFile(path.join(jobDir, "a.info.json"), "{}");
  await fsp.writeFile(path.join(jobDir, "a.live_chat.json"), "{}");
  await fsp.writeFile(path.join(jobDir, "a.vtt"), "WEBVTT");

  service.enqueueJob(jobDir);
  service.enqueueJob(jobDir);
  await delay(1200);

  assert.equal(calls.length, 2);
  assert.equal(fs.existsSync(path.join(commentsDir, "a.info.json")), true);
  assert.equal(fs.existsSync(path.join(liveChatDir, "a.live_chat.json")), true);
  assert.equal(fs.existsSync(path.join(subtitleDir, "a.vtt")), true);
  assert.equal(fs.existsSync(jobDir), false);

  await fsp.rm(tempDir, { recursive: true, force: true });
});

test("job-queue-service broadcasts status_update on processing error", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ytdl-queue-err-"));
  const pendingChatDir = path.join(tempDir, "pending");
  const commentsDir = path.join(tempDir, "comments");
  const liveChatDir = path.join(tempDir, "live");
  const subtitleDir = path.join(tempDir, "subtitle");
  await fsp.mkdir(pendingChatDir, { recursive: true });
  await fsp.mkdir(commentsDir, { recursive: true });
  await fsp.mkdir(liveChatDir, { recursive: true });
  await fsp.mkdir(subtitleDir, { recursive: true });

  const events = [];
  const service = createJobQueueService({
    rootDir: tempDir,
    pendingChatDir,
    commentsDir,
    liveChatDir,
    subtitleDir,
    broadcast: (event, data) => events.push({ event, data }),
    runScript: async () => {
      throw new Error("boom");
    },
    enableWatch: false,
  });

  const jobDir = path.join(pendingChatDir, "job_failed");
  await fsp.mkdir(jobDir, { recursive: true });
  service.enqueueJob(jobDir);
  await delay(700);

  const errEvent = events.find((ev) => ev.event === "status_update");
  assert.ok(errEvent);
  assert.equal(errEvent.data.id, "job_failed");
  assert.equal(errEvent.data.status, "error");

  await fsp.rm(tempDir, { recursive: true, force: true });
});
