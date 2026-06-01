const test = require("node:test");
const assert = require("node:assert/strict");

const {
  registerScheduleRoutes,
  buildScheduleResultFromStdout,
  buildUnsupportedScheduleStatus,
  detectScheduleModeFromXml,
  isWindowsPlatform,
  WINDOWS_AUTOSTART_ONLY_MESSAGE,
} = require("../server/routes/schedule-routes");

test("buildScheduleResultFromStdout parses SUCCESS output", () => {
  const result = buildScheduleResultFromStdout("SUCCESS: Task created\nextra");
  assert.deepEqual(result, {
    ok: true,
    message: "Task created",
    detail: null,
  });
});

test("buildScheduleResultFromStdout parses ERROR output", () => {
  const result = buildScheduleResultFromStdout("ERROR: Failed to create task");
  assert.deepEqual(result, {
    ok: false,
    message: "Failed to create task",
    detail: "ERROR: Failed to create task",
  });
});

test("buildScheduleResultFromStdout returns null for unknown output", () => {
  const result = buildScheduleResultFromStdout("some unexpected output");
  assert.equal(result, null);
});

test("detectScheduleModeFromXml detects startup trigger", () => {
  const result = detectScheduleModeFromXml("<Task><Triggers><BootTrigger /></Triggers></Task>");
  assert.equal(result, "startup");
});

test("detectScheduleModeFromXml detects logon trigger", () => {
  const result = detectScheduleModeFromXml("<Task><Triggers><LogonTrigger /></Triggers></Task>");
  assert.equal(result, "logon");
});

test("detectScheduleModeFromXml returns unknown when no trigger is matched", () => {
  const result = detectScheduleModeFromXml("<Task><Triggers></Triggers></Task>");
  assert.equal(result, "unknown");
});

test("isWindowsPlatform detects only win32", () => {
  assert.equal(isWindowsPlatform("win32"), true);
  assert.equal(isWindowsPlatform("darwin"), false);
  assert.equal(isWindowsPlatform("linux"), false);
});


test("buildUnsupportedScheduleStatus describes non-Windows autostart support", () => {
  assert.deepEqual(buildUnsupportedScheduleStatus("darwin"), {
    enabled: false,
    mode: "unsupported",
    supported: false,
    platform: "darwin",
    message: WINDOWS_AUTOSTART_ONLY_MESSAGE,
  });
});

test("schedule routes do not invoke PowerShell scripts on non-Windows platforms", async () => {
  const routes = new Map();
  const app = {
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
  };
  let spawnCount = 0;
  const apiOk = (res, data) => {
    res.statusCode = 200;
    res.body = { ok: true, data };
    return res;
  };
  const apiError = (res, status, error, extra = {}) => {
    res.statusCode = status;
    res.body = { ok: false, error, ...extra };
    return res;
  };

  registerScheduleRoutes(app, {
    path: require("node:path"),
    os: require("node:os"),
    spawn: () => {
      spawnCount += 1;
      throw new Error("spawn should not be called");
    },
    baseDir: process.cwd(),
    apiOk,
    apiError,
    platform: "darwin",
  });

  const statusRes = {};
  await routes.get("GET /api/schedule/status")({}, statusRes);
  assert.equal(statusRes.statusCode, 200);
  assert.deepEqual(statusRes.body.data, buildUnsupportedScheduleStatus("darwin"));

  const createRes = {};
  await routes.get("POST /api/schedule/create")({ body: { mode: "logon" } }, createRes);
  assert.equal(createRes.statusCode, 501);
  assert.equal(createRes.body.error, WINDOWS_AUTOSTART_ONLY_MESSAGE);
  assert.deepEqual(createRes.body.data, buildUnsupportedScheduleStatus("darwin"));

  const deleteRes = {};
  await routes.get("POST /api/schedule/delete")({}, deleteRes);
  assert.equal(deleteRes.statusCode, 501);
  assert.equal(deleteRes.body.error, WINDOWS_AUTOSTART_ONLY_MESSAGE);
  assert.equal(spawnCount, 0);
});
