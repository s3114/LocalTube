const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildScheduleResultFromStdout,
  detectScheduleModeFromXml,
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
