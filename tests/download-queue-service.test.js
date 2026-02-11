const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createDownloadQueueService,
} = require("../server/services/download-queue-service");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("download-queue-service processes queued jobs and updates statuses", async () => {
  const jobHistory = new Map();
  const events = [];
  const processedIds = [];

  const service = createDownloadQueueService({
    jobHistory,
    broadcast: (event, payload) => events.push({ event, payload }),
    processJob: async (job) => {
      processedIds.push(job.id);
      await delay(10);
    },
  });

  service.setMaxConcurrentDownloads(2);

  const jobs = [
    {
      id: "a",
      status: "queued",
      progress: { eta: "" },
    },
    {
      id: "b",
      status: "queued",
      progress: { eta: "" },
    },
  ];
  service.enqueueJobs(jobs);
  await delay(120);

  assert.deepEqual(processedIds.sort(), ["a", "b"]);
  assert.equal(jobHistory.size, 2);
  assert.equal(jobHistory.get("a").status, "completed");
  assert.equal(jobHistory.get("b").status, "completed");
  assert.ok(events.some((e) => e.event === "status_update" && e.payload.status === "completed"));
});

test("download-queue-service retries and eventually errors when process fails", async () => {
  const jobHistory = new Map();
  const events = [];
  let attempts = 0;

  const service = createDownloadQueueService({
    jobHistory,
    broadcast: (event, payload) => events.push({ event, payload }),
    processJob: async () => {
      attempts++;
      throw new Error("download failed");
    },
    maxRetries: 2,
    retryDelayMs: 30,
  });

  service.enqueueJobs([
    {
      id: "x",
      status: "queued",
      progress: { eta: "" },
    },
  ]);

  await delay(180);

  assert.equal(attempts, 2);
  assert.equal(jobHistory.get("x").status, "error");
  assert.ok(events.some((e) => e.event === "status_update" && e.payload.status === "error"));
});
