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
    "format-report-loading-backdrop": {
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
    "yt-dlp-custom-command-input": { value: values.customCommand || "" },
    "comment-options": { value: "both" },
  };

  return {
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
  const { getElementById, elements } = createDoc({
    urls: "https://example.com/video1 https://example.com/video2",
  });

  const parseApiResponse = async (response) => response.__parsed;
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    if (String(url).startsWith("/api/validate-url")) {
      return { __parsed: { ok: true, data: { isValid: true } } };
    }
    return { __parsed: { ok: true, data: { message: "ok" } } };
  };

  const actions = global.createDownloadActions({
    parseApiResponse,
    fetchImpl,
    doc: { getElementById },
    alertImpl: (msg) => alerts.push(msg),
  });

  await actions.startDownload();

  assert.equal(alerts.length, 0);
  assert.equal(elements.urls.value, "");
  assert.equal(elements["download-btn"].disabled, false);
  assert.ok(fetchCalls.some((c) => c.url === "/download"));
});

test("download action downloads attachment report when server returns HTML attachment", async () => {
  loadActions();
  const alerts = [];
  const infos = [];
  const fetchCalls = [];
  const { getElementById, elements } = createDoc({
    urls: "https://example.com/video1",
  });
  let downloaded = null;

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      if (String(url).startsWith("/api/validate-url")) {
        return { __parsed: { ok: true, data: { isValid: true } } };
      }
      return {
        ok: true,
        headers: {
          get(name) {
            if (String(name).toLowerCase() === "content-disposition") {
              return 'attachment; filename="localtube-report-formats-20260427-123456.html"';
            }
            return "";
          },
        },
      };
    },
    doc: { getElementById },
    alertImpl: (msg) => alerts.push(msg),
    notifyInfo: (message) => infos.push(message),
    downloadAttachmentResponse: async (response, fallbackFilename) => {
      downloaded = {
        fallbackFilename,
        filename: response.headers.get("content-disposition"),
      };
    },
  });

  await actions.startDownload();

  assert.equal(alerts.length, 0);
  assert.equal(elements.urls.value, "");
  assert.equal(elements["download-btn"].disabled, false);
  assert.deepEqual(downloaded, {
    fallbackFilename: "localtube-report-formats.html",
    filename: 'attachment; filename="localtube-report-formats-20260427-123456.html"',
  });
  assert.deepEqual(infos, ["フォーマットレポートをダウンロードしました。"]);
  assert.ok(fetchCalls.some((call) => call.url === "/download"));
});

test("download action shows format loading overlay in list-formats mode", async () => {
  loadActions();
  const hiddenStates = [];
  const { getElementById, elements } = createDoc({
    urls: "https://example.com/video1",
    customCommand: "--list-formats",
  });

  const originalRemove = elements["format-report-loading-backdrop"].classList.remove;
  const originalAdd = elements["format-report-loading-backdrop"].classList.add;
  elements["format-report-loading-backdrop"].classList.remove = function remove(value) {
    hiddenStates.push(`remove:${value}`);
    return originalRemove.call(this, value);
  };
  elements["format-report-loading-backdrop"].classList.add = function add(value) {
    hiddenStates.push(`add:${value}`);
    return originalAdd.call(this, value);
  };

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url) => {
      if (String(url).startsWith("/api/validate-url")) {
        return { __parsed: { ok: true, data: { isValid: true } } };
      }
      return {
        ok: true,
        headers: {
          get(name) {
            if (String(name).toLowerCase() === "content-disposition") {
              return 'attachment; filename="localtube-report-formats-20260427-123456.html"';
            }
            return "";
          },
        },
      };
    },
    doc: { getElementById },
    alertImpl: () => {},
    downloadAttachmentResponse: async () => {},
  });

  await actions.startDownload();

  assert.ok(hiddenStates.includes("remove:hidden"));
  assert.ok(hiddenStates.includes("add:hidden"));
  assert.equal(
    elements["format-report-loading-backdrop"].classList.contains("hidden"),
    true,
  );
});

test("download action blocks invalid URL before submit", async () => {
  loadActions();
  const alerts = [];
  const fetchCalls = [];
  const { getElementById } = createDoc({ urls: "http://invalid.local/video" });

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return { __parsed: { ok: true, data: { isValid: true } } };
    },
    doc: { getElementById },
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
  const { getElementById, elements } = createDoc({ urls: "https://example.com/video" });

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
    doc: { getElementById },
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
  const { getElementById, elements } = createDoc({ urls: "https://example.com/video" });

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async () => {
      throw new Error("network down");
    },
    doc: { getElementById },
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
  const { getElementById, elements } = createDoc({ urls: "https://example.com/video" });
  elements.optDownloadComments.checked = false;
  elements.optDownloadChat.checked = false;
  elements.optDownloadVideo.checked = false;

  const actions = global.createDownloadActions({
    parseApiResponse: async (response) => response.__parsed,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return { __parsed: { ok: true, data: { isValid: true } } };
    },
    doc: { getElementById },
    alertImpl: (msg) => alerts.push(msg),
  });

  await actions.startDownload();

  assert.equal(fetchCalls.length, 0);
  assert.equal(alerts.length, 0);
  assert.equal(elements["download-btn"].disabled, false);
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
    utils.extractFilenameFromDisposition(
      'attachment; filename="localtube-report-formats-20260427-123456.html"',
    ),
    "localtube-report-formats-20260427-123456.html",
  );
  assert.equal(
    utils.isAttachmentResponse({
      headers: {
        get() {
          return 'attachment; filename="sample.html"';
        },
      },
    }),
    true,
  );
  assert.equal(utils.hasListFormatsCommand("--list-formats"), true);
  assert.equal(utils.hasListFormatsCommand("-F"), true);
  assert.equal(utils.hasListFormatsCommand("--no-warnings"), false);
});
