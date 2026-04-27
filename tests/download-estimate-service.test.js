const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const EventEmitter = require("node:events");

const {
  createDownloadEstimateService,
} = require("../server/services/download-estimate-service");

function createSpawnStub({ stdout = "", stderr = "", code = 0, onSpawn } = {}) {
  return (command, args) => {
    onSpawn?.(command, args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    process.nextTick(() => {
      if (stdout) child.stdout.emit("data", Buffer.from(stdout));
      if (stderr) child.stderr.emit("data", Buffer.from(stderr));
      child.emit("close", code);
    });

    return child;
  };
}

function createSpawnSequenceStub(sequence) {
  const steps = Array.isArray(sequence) ? sequence : [];
  let index = 0;
  return (command, args) => {
    const current = steps[Math.min(index, steps.length - 1)] || {};
    index += 1;
    current.onSpawn?.(command, args);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    process.nextTick(() => {
      if (current.stdout) child.stdout.emit("data", Buffer.from(current.stdout));
      if (current.stderr) child.stderr.emit("data", Buffer.from(current.stderr));
      child.emit("close", current.code ?? 0);
    });

    return child;
  };
}

test("download-estimate-service returns live skip result without extra handling", async () => {
  const spawnCalls = [];
  const service = createDownloadEstimateService({
    spawn: createSpawnStub({
      stdout: JSON.stringify({
        title: "live stream",
        is_live: true,
        live_status: "is_live",
      }),
      onSpawn: (_command, args) => spawnCalls.push(args),
    }),
    path,
    baseDir: process.cwd(),
  });

  const result = await service.estimateUrl("https://www.youtube.com/watch?v=live");

  assert.equal(spawnCalls.length, 1);
  assert.equal(result.title, "live stream");
  assert.equal(result.estimatedBytes, null);
  assert.equal(result.estimatedSizeText, "配信中のため未取得");
  assert.equal(result.skippedLiveEstimate, true);
});

test("download-estimate-service summarizes live skipped entries distinctly", () => {
  const service = createDownloadEstimateService({
    spawn: createSpawnStub(),
    path,
    baseDir: process.cwd(),
  });

  const summary = service.buildEstimateSummary([
    { estimatedBytes: 1024, estimatedSizeText: "1 KB" },
    { estimatedBytes: null, estimatedSizeText: "配信中のため未取得", skippedLiveEstimate: true },
    { estimatedBytes: null, estimatedSizeText: "不明" },
  ]);

  assert.equal(summary.totalText, "1 KB + 配信中1件 + 不明1件");
  assert.equal(summary.liveSkippedCount, 1);
  assert.equal(summary.unknownCount, 1);
});

test("download-estimate-service keeps overall count out of live-only total text", () => {
  const service = createDownloadEstimateService({
    spawn: createSpawnStub(),
    path,
    baseDir: process.cwd(),
  });

  const summary = service.buildEstimateSummary([
    { estimatedBytes: null, estimatedSizeText: "配信中のため未取得", skippedLiveEstimate: true },
  ]);

  assert.equal(summary.totalText, "配信中のため未取得");
  assert.equal(summary.count, 1);
});

test("download-estimate-service retries once without format when requested format is unavailable", async () => {
  const spawnCalls = [];
  const service = createDownloadEstimateService({
    spawn: createSpawnSequenceStub([
      {
        code: 1,
        stderr:
          "ERROR: [youtube] sample: Requested format is not available. Use --list-formats for a list of available formats",
        onSpawn: (_command, args) => {
          spawnCalls.push(args);
        },
      },
      {
        stdout: JSON.stringify({
          title: "live stream",
          is_live: true,
          live_status: "is_live",
        }),
        onSpawn: (_command, args) => {
          spawnCalls.push(args);
        },
      },
    ]),
    path,
    baseDir: process.cwd(),
  });

  const result = await service.estimateUrl("https://www.youtube.com/watch?v=live", {
    downloadVideo: true,
    format: "bv[height=2160]+ba",
  });

  assert.equal(spawnCalls.length, 2);
  assert.ok(spawnCalls[0].includes("-f"));
  assert.equal(spawnCalls[0].includes("bv[height=2160]+ba"), true);
  assert.equal(spawnCalls[1].includes("-f"), false);
  assert.equal(result.estimatedSizeText, "配信中のため未取得");
  assert.equal(result.skippedLiveEstimate, true);
});
