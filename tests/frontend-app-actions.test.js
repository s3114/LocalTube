const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const actionsPath = path.join(__dirname, "..", "public", "app-actions.js");

function loadActions() {
  global.window = global;
  delete require.cache[require.resolve(actionsPath)];
  require(actionsPath);
}

function createDoc(values = {}) {
  const elements = {
    "download-btn": { disabled: false },
    "estimate-loading-backdrop": {
      classList: {
        values: new Set(["hidden"]),
        add(value) {
          this.values.add(value);
        },
        remove(value) {
          this.values.delete(value);
        },
        contains(value) {
          return this.values.has(value);
        },
      },
    },
    "download-estimate-status": { textContent: "" },
    "download-estimate-list-section": {
      classList: {
        values: new Set(["hidden"]),
        add(value) {
          this.values.add(value);
        },
        remove(value) {
          this.values.delete(value);
        },
        contains(value) {
          return this.values.has(value);
        },
      },
    },
    "download-estimate-list-total": { textContent: "" },
    "download-estimate-list-toggle": {
      textContent: "",
      classList: {
        values: new Set(),
        add(value) {
          this.values.add(value);
        },
        remove(value) {
          this.values.delete(value);
        },
        toggle(value, force) {
          if (typeof force === "boolean") {
            if (force) {
              this.values.add(value);
              return true;
            }
            this.values.delete(value);
            return false;
          }
          if (this.values.has(value)) {
            this.values.delete(value);
            return false;
          }
          this.values.add(value);
          return true;
        },
        contains(value) {
          return this.values.has(value);
        },
      },
    },
    "download-estimate-list": {
      innerHTML: "",
      children: [],
      classList: {
        values: new Set(),
        add(value) {
          this.values.add(value);
        },
        remove(value) {
          this.values.delete(value);
        },
        toggle(value, force) {
          if (typeof force === "boolean") {
            if (force) {
              this.values.add(value);
              return true;
            }
            this.values.delete(value);
            return false;
          }
          if (this.values.has(value)) {
            this.values.delete(value);
            return false;
          }
          this.values.add(value);
          return true;
        },
        contains(value) {
          return this.values.has(value);
        },
      },
      appendChild(node) {
        if (Array.isArray(node?.children)) {
          this.children.push(...node.children);
          return;
        }
        this.children.push(node);
      },
    },
    urls: { value: values.urls || "" },
    fmt: { value: "best" },
    optHistory: { checked: true },
    optThumb: { checked: true },
    optDownloadComments: { checked: true },
    optDownloadChat: { checked: true },
    optDownloadVideo: { checked: true },
    optDrm: { checked: false },
    savePath: { value: "" },
    optParallelDownloads: { value: "3" },
    optConcurrentFragments: { value: "4" },
    "comment-options": { value: "both" },
  };

  return {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        textContent: "",
      };
    },
    createDocumentFragment() {
      return {
        children: [],
        appendChild(node) {
          this.children.push(node);
        },
      };
    },
    getElementById(id) {
      return elements[id];
    },
    elements,
  };
}

test("download action validates and submits then clears input", async () => {
  loadActions();
  const alerts = [];
  const fetchCalls = [];
  const doc = createDoc({
    urls: "https://example.com/video1 https://example.com/video2",
  });
  const { elements } = doc;

  const parseApiResponse = async (response) => response.__parsed;
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    if (String(url).startsWith("/api/validate-url")) {
      return { __parsed: { ok: true, data: { isValid: true } } };
    }
    if (String(url) === "/api/download-estimate") {
      return {
        __parsed: {
          ok: true,
          data: {
            entries: [
              { url: "https://example.com/video1", estimatedSizeText: "1.2 GB" },
              { url: "https://example.com/video2", estimatedSizeText: "800 MB" },
            ],
            summary: { totalText: "2.0 GB", count: 2 },
          },
        },
      };
    }
    return { __parsed: { ok: true, data: { message: "ok" } } };
  };

  const actions = global.createDownloadActions({
    parseApiResponse,
    fetchImpl,
    doc,
    alertImpl: (msg) => alerts.push(msg),
    showDownloadConfirm: async () => ({ confirmed: true, skipFuture: false }),
  });

  await actions.startDownload();

  assert.equal(alerts.length, 0);
  assert.equal(elements.urls.value, "");
  assert.equal(elements["download-btn"].disabled, false);
  assert.equal(elements["download-estimate-status"].textContent, "予測サイズ: 2.0 GB (2件)");
  assert.equal(elements["download-estimate-list-section"].classList.contains("hidden"), false);
  assert.equal(elements["download-estimate-list-total"].textContent, "合計: 2.0 GB");
  assert.equal(elements["download-estimate-list-toggle"].textContent, "折りたたむ");
  assert.equal(elements["download-estimate-list-toggle"].classList.contains("hidden"), false);
  assert.deepEqual(
    elements["download-estimate-list"].children.map((item) => item.textContent),
    [
      "https://example.com/video1 - 1.2 GB",
      "https://example.com/video2 - 800 MB",
    ],
  );
  assert.ok(fetchCalls.some((c) => c.url === "/api/download-estimate"));
  assert.ok(fetchCalls.some((c) => c.url === "/download"));
});

test("download action shows estimate loading overlay while fetching estimate", async () => {
  loadActions();
  const doc = createDoc({
    urls: "https://example.com/video1",
  });
  const { elements } = doc;
  const overlayEvents = [];
  const originalRemove = elements["estimate-loading-backdrop"].classList.remove;
  const originalAdd = elements["estimate-loading-backdrop"].classList.add;
  elements["estimate-loading-backdrop"].classList.remove = function remove(value) {
    overlayEvents.push(`remove:${value}`);
    return originalRemove.call(this, value);
  };
  elements["estimate-loading-backdrop"].classList.add = function add(value) {
    overlayEvents.push(`add:${value}`);
    return originalAdd.call(this, value);
  };

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url) => {
      if (String(url).startsWith("/api/validate-url")) {
        return { __parsed: { ok: true, data: { isValid: true } } };
      }
      if (String(url) === "/api/download-estimate") {
        return {
          __parsed: {
            ok: true,
            data: {
              entries: [
                { title: "single video", estimatedSizeText: "3 GB" },
              ],
              summary: { totalText: "3 GB", count: 1 },
            },
          },
        };
      }
      return { __parsed: { ok: true, data: { message: "ok" } } };
    },
    doc,
    alertImpl: () => {},
    showDownloadConfirm: async () => ({ confirmed: true, skipFuture: false }),
  });

  await actions.startDownload();

  assert.ok(overlayEvents.includes("remove:hidden"));
  assert.ok(overlayEvents.includes("add:hidden"));
  assert.equal(elements["estimate-loading-backdrop"].classList.contains("hidden"), true);
});

test("download action blocks invalid URL before submit", async () => {
  loadActions();
  const alerts = [];
  const fetchCalls = [];
  const doc = createDoc({ urls: "http://invalid.local/video" });

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return { __parsed: { ok: true, data: { isValid: true } } };
    },
    doc,
    alertImpl: (msg) => alerts.push(msg),
  });

  await actions.startDownload();

  assert.equal(fetchCalls.length, 0);
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].includes("https:// で始まるURL"));
});

test("download action blocks submit when URL validation API returns invalid", async () => {
  loadActions();
  const alerts = [];
  const fetchCalls = [];
  const doc = createDoc({ urls: "https://example.com/video" });
  const { elements } = doc;

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      return {
        __parsed: {
          ok: true,
          data: { isValid: false, error: "forbidden" },
          error: null,
        },
      };
    },
    doc,
    alertImpl: (msg) => alerts.push(msg),
  });

  await actions.startDownload();

  assert.equal(elements["download-btn"].disabled, false);
  assert.equal(elements.urls.value, "https://example.com/video");
  assert.equal(fetchCalls.filter((url) => String(url) === "/download").length, 0);
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].includes("アクセスできません"));
});

test("download action reports network error and re-enables button", async () => {
  loadActions();
  const alerts = [];
  const errors = [];
  const doc = createDoc({ urls: "https://example.com/video" });
  const { elements } = doc;

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async () => {
      throw new Error("network down");
    },
    doc,
    alertImpl: (msg) => alerts.push(msg),
    onError: (error) => errors.push(error.message),
  });

  await actions.startDownload();

  assert.equal(elements["download-btn"].disabled, false);
  assert.equal(alerts.length, 1);
  assert.ok(alerts[0].includes("ネットワークエラー"));
  assert.deepEqual(errors, ["network down"]);
});

test("download action does nothing when comments, chat, and video are all off", async () => {
  loadActions();
  const alerts = [];
  const fetchCalls = [];
  const doc = createDoc({ urls: "https://example.com/video" });
  const { elements } = doc;
  elements.optDownloadComments.checked = false;
  elements.optDownloadChat.checked = false;
  elements.optDownloadVideo.checked = false;

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return { __parsed: { ok: true, data: { isValid: true } } };
    },
    doc,
    alertImpl: (msg) => alerts.push(msg),
  });

  await actions.startDownload();

  assert.equal(fetchCalls.length, 0);
  assert.equal(alerts.length, 0);
  assert.equal(elements["download-btn"].disabled, false);
});

test("download action persists skip-confirm preference when requested", async () => {
  loadActions();
  const saved = [];
  const doc = createDoc({ urls: "https://example.com/video" });

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url) => {
      if (String(url).startsWith("/api/validate-url")) {
        return { __parsed: { ok: true, data: { isValid: true } } };
      }
      if (String(url) === "/api/download-estimate") {
        return {
          __parsed: {
            ok: true,
            data: { entries: [], summary: { totalText: "1.0 GB", count: 1 } },
          },
        };
      }
      return { __parsed: { ok: true, data: { message: "ok" } } };
    },
    doc,
    alertImpl: () => {},
    showDownloadConfirm: async () => ({ confirmed: true, skipFuture: true }),
    saveSetting: (key, value) => saved.push({ key, value }),
  });

  await actions.startDownload();

  assert.deepEqual(saved, [
    { key: "localtube.skipDownloadConfirm.v1", value: true },
  ]);
});

test("download action skips estimate fetch when disabled by setting", async () => {
  loadActions();
  const fetchCalls = [];
  const doc = createDoc({ urls: "https://example.com/video" });
  const { elements } = doc;

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url) => {
      fetchCalls.push(String(url));
      if (String(url).startsWith("/api/validate-url")) {
        return { __parsed: { ok: true, data: { isValid: true } } };
      }
      return { __parsed: { ok: true, data: { message: "ok" } } };
    },
    doc,
    alertImpl: () => {},
    loadSetting: (key, defaultValue) => {
      if (key === "optDownloadEstimates") return false;
      return defaultValue;
    },
    showDownloadConfirm: async () => ({ confirmed: true, skipFuture: false }),
  });

  await actions.startDownload();

  assert.equal(fetchCalls.includes("/api/download-estimate"), false);
  assert.equal(elements["download-estimate-status"].textContent, "");
  assert.equal(elements["download-estimate-list-section"].classList.contains("hidden"), true);
});

test("download action shows a single estimate entry without hiding it in total row", async () => {
  loadActions();
  const doc = createDoc({ urls: "https://example.com/video" });
  const { elements } = doc;

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url) => {
      if (String(url).startsWith("/api/validate-url")) {
        return { __parsed: { ok: true, data: { isValid: true } } };
      }
      if (String(url) === "/api/download-estimate") {
        return {
          __parsed: {
            ok: true,
            data: {
              entries: [
                { title: "single video", estimatedSizeText: "3 GB" },
              ],
              summary: { totalText: "3 GB", count: 1 },
            },
          },
        };
      }
      return { __parsed: { ok: true, data: { message: "ok" } } };
    },
    doc,
    alertImpl: () => {},
    showDownloadConfirm: async () => ({ confirmed: true, skipFuture: false }),
  });

  await actions.startDownload();

  assert.equal(elements["download-estimate-list-total"].textContent, "合計: 3 GB");
  assert.deepEqual(
    elements["download-estimate-list"].children.map((item) => item.textContent),
    ["single video - 3 GB"],
  );
  assert.equal(elements["download-estimate-list-toggle"].classList.contains("hidden"), true);
});

test("download action auto-collapses estimate list when six or more lines are shown", async () => {
  loadActions();
  const doc = createDoc({ urls: "https://example.com/video" });
  const { elements } = doc;

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url) => {
      if (String(url).startsWith("/api/validate-url")) {
        return { __parsed: { ok: true, data: { isValid: true } } };
      }
      if (String(url) === "/api/download-estimate") {
        return {
          __parsed: {
            ok: true,
            data: {
              entries: [
                { title: "total", estimatedSizeText: "10 GB" },
                { title: "a", estimatedSizeText: "1 GB" },
                { title: "b", estimatedSizeText: "1 GB" },
                { title: "c", estimatedSizeText: "1 GB" },
                { title: "d", estimatedSizeText: "1 GB" },
                { title: "e", estimatedSizeText: "1 GB" },
              ],
              summary: { totalText: "10 GB", count: 6 },
            },
          },
        };
      }
      return { __parsed: { ok: true, data: { message: "ok" } } };
    },
    doc,
    alertImpl: () => {},
    showDownloadConfirm: async () => ({ confirmed: true, skipFuture: false }),
  });

  await actions.startDownload();

  assert.equal(elements["download-estimate-list"].classList.contains("collapsed"), true);
  assert.equal(elements["download-estimate-list-toggle"].textContent, "展開");
});

test("app-actions pure utils parse URL inputs", () => {
  loadActions();
  const utils = global.__appActionsTestUtils;

  assert.equal(utils.parseUrlsFromInputValue("").ok, false);
  assert.equal(utils.parseUrlsFromInputValue("   ").ok, false);
  assert.deepEqual(utils.parseUrlsFromInputValue("https://a https://b").urls, [
    "https://a",
    "https://b",
  ]);
  assert.deepEqual(utils.parseUrlsFromInputValue("https://a,\nhttps://b").urls, [
    "https://a",
    "https://b",
  ]);
});

test("app-actions pure utils validate HTTPS scheme", () => {
  loadActions();
  const utils = global.__appActionsTestUtils;

  assert.equal(utils.isHttpsUrl("https://example.com"), true);
  assert.equal(utils.isHttpsUrl("http://example.com"), false);
  assert.equal(utils.isHttpsUrl(""), false);
  assert.equal(
    utils.resolveCommentOptions({ downloadComments: true, downloadChat: true }),
    "both",
  );
  assert.equal(
    utils.resolveCommentOptions({ downloadComments: true, downloadChat: false }),
    "comments",
  );
  assert.equal(
    utils.resolveCommentOptions({ downloadComments: false, downloadChat: true }),
    "sub",
  );
  assert.equal(
    utils.resolveCommentOptions({ downloadComments: false, downloadChat: false }),
    "none",
  );
  assert.equal(
    utils.formatEstimateSummary({ totalText: "1.2 GB", count: 2 }),
    "予測サイズ: 1.2 GB (2件)",
  );
  assert.equal(
    utils.formatEstimateTotal({ totalText: "1.2 GB", count: 2 }),
    "合計: 1.2 GB",
  );
});
