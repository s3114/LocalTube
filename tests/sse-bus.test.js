const test = require("node:test");
const assert = require("node:assert/strict");

const { createSseBus } = require("../server/services/sse-bus");

test("sse-bus registers /events and /ping and broadcasts to connected clients", async () => {
  const routes = new Map();
  const app = {
    get(...args) {
      const routePath = args[0];
      const handler = args[args.length - 1];
      routes.set(routePath, handler);
    },
  };

  const jobHistory = new Map([["1", { id: "1", status: "queued" }]]);
  let apiOkCalled = false;

  const bus = createSseBus({
    sseExpress: (_req, _res, next) => next?.(),
    jobHistory,
    serverStartTime: Date.now() - 5000,
    measureNetworkMbps: async () => ({ latency_ms: 12, approx_mbps: 345 }),
    apiOk: (res, data) => {
      apiOkCalled = true;
      res.__ok = data;
    },
  });

  bus.registerRoutes(app);

  assert.equal(routes.has("/events"), true);
  assert.equal(routes.has("/ping"), true);

  const sentEvents = [];
  let closeHandler = null;
  const req = {
    on(event, handler) {
      if (event === "close") closeHandler = handler;
    },
  };
  const res = {
    sse(event, data) {
      sentEvents.push({ event, data });
    },
  };

  await routes.get("/events")(req, res);

  const initialEvent = sentEvents.find((ev) => ev.event === "initial_state");
  assert.ok(initialEvent);
  assert.deepEqual(initialEvent.data, Array.from(jobHistory.values()));

  bus.broadcast("status_update", { id: "1", status: "completed" });
  const broadcastEvent = sentEvents.find((ev) => ev.event === "status_update");
  assert.ok(broadcastEvent);
  assert.deepEqual(broadcastEvent.data, { id: "1", status: "completed" });

  const pingRes = {};
  routes.get("/ping")({}, pingRes);
  assert.equal(apiOkCalled, true);
  assert.deepEqual(pingRes.__ok, { pong: true });

  if (closeHandler) {
    closeHandler();
  }
});
