const test = require("node:test");
const assert = require("node:assert/strict");
const { createLogger, normalizeLogLevel } = require("../server/services/logger-service");

function withStubbedConsole(run) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  const calls = {
    log: [],
    warn: [],
    error: [],
  };

  console.log = (...args) => calls.log.push(args);
  console.warn = (...args) => calls.warn.push(args);
  console.error = (...args) => calls.error.push(args);

  try {
    run(calls);
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

test("normalizeLogLevel uses info for invalid values", () => {
  assert.equal(normalizeLogLevel(""), "info");
  assert.equal(normalizeLogLevel("foo"), "info");
  assert.equal(normalizeLogLevel("WARN"), "warn");
});

test("logger level=info outputs all levels", () => {
  withStubbedConsole((calls) => {
    const logger = createLogger("test", { level: "info" });
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    assert.equal(calls.log.length, 1);
    assert.equal(calls.warn.length, 1);
    assert.equal(calls.error.length, 1);
  });
});

test("logger level=warn suppresses info", () => {
  withStubbedConsole((calls) => {
    const logger = createLogger("test", { level: "warn" });
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    assert.equal(calls.log.length, 0);
    assert.equal(calls.warn.length, 1);
    assert.equal(calls.error.length, 1);
  });
});

test("logger level=error suppresses info and warn", () => {
  withStubbedConsole((calls) => {
    const logger = createLogger("test", { level: "error" });
    logger.info("i");
    logger.warn("w");
    logger.error("e");

    assert.equal(calls.log.length, 0);
    assert.equal(calls.warn.length, 0);
    assert.equal(calls.error.length, 1);
  });
});

