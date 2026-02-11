const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildScheduleResultFromStdout,
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
