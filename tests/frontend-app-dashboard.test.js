const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const dashboardPath = path.join(__dirname, "..", "public", "app-dashboard.js");

function loadDashboardModule() {
  global.window = global;
  delete require.cache[require.resolve(dashboardPath)];
  require(dashboardPath);
}

test("dashboard controller uses injected EventSource and updates counts from initial_state", () => {
  loadDashboardModule();

  const elements = {
    "info-total-count": { textContent: "" },
    "info-completed-count": { textContent: "" },
    "info-running-count": { textContent: "" },
    "info-error-count": { textContent: "" },
    "completion-bar": { style: { width: "" } },
    "completion-text": { textContent: "" },
    "job-queue": {
      innerHTML: "",
      children: [],
      appendChild(fragment) {
        if (Array.isArray(fragment.children)) {
          this.children.push(...fragment.children);
        }
      },
    },
  };
  const documentRef = {
    getElementById(id) {
      return elements[id] || null;
    },
    createDocumentFragment() {
      return {
        children: [],
        appendChild(node) {
          this.children.push(node);
        },
      };
    },
  };

  let eventSourceInstance = null;
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      eventSourceInstance = this;
    }
    addEventListener(name, fn) {
      this.listeners.set(name, fn);
    }
    close() {}
  }

  const jobStates = new Map();
  const controller = global.createDashboardController({
    jobStates,
    renderJob(job) {
      jobStates.set(job.id, job);
      return { jobId: job.id };
    },
    updateJobElement() {},
    documentRef,
    EventSourceImpl: FakeEventSource,
    ChartImpl: null,
  });

  controller.createSseController({
    jobQueueElement: elements["job-queue"],
  });

  assert.equal(eventSourceInstance.url, "/events");
  eventSourceInstance.listeners.get("initial_state")({
    data: JSON.stringify([
      { id: "a", status: "completed", progress: {} },
      { id: "b", status: "error", progress: {} },
    ]),
  });

  assert.equal(elements["info-total-count"].textContent, "2 件");
  assert.equal(elements["info-completed-count"].textContent, "1 件");
  assert.equal(elements["info-error-count"].textContent, "1 件");
  assert.equal(elements["completion-text"].textContent, "50%");
});
