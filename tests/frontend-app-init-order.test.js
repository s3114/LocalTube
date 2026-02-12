const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "public", "app.js");

function createElement() {
  return {
    value: "",
    checked: false,
    textContent: "",
    innerHTML: "",
    style: {},
    classList: {
      add() {},
      remove() {},
    },
    addEventListener() {},
  };
}

test("app initialization runs in fixed order on DOMContentLoaded", () => {
  const callOrder = [];
  const docListeners = new Map();
  const elements = new Map();
  const settingsCalls = [];

  global.window = global;
  global.document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createElement());
      }
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    addEventListener(name, fn) {
      docListeners.set(name, fn);
    },
  };

  global.createUiFeedback = () => ({
    showInfo() {},
    showSuccess() {},
    showError() {},
  });
  global.createAppCore = () => ({
    renderJob() {
      return {};
    },
    updateJobElement() {},
    parseApiResponse: async () => ({ ok: true, data: null }),
    linkifyText(text) {
      return String(text || "");
    },
  });
  global.createDashboardController = () => ({
    createSseController() {
      callOrder.push("sse");
      return { close() {} };
    },
  });
  global.createLocalVideoModule = () => ({
    createVideoDataController() {
      return {};
    },
    createLocalVideoController() {
      return {};
    },
  });
  global.createDownloadActions = () => ({
    startDownload() {},
  });
  global.createHeaderRoutingController = () => ({
    initialize() {
      callOrder.push("routing");
    },
  });
  global.createPlayerPageController = () => ({
    initialize() {
      callOrder.push("player");
    },
  });
  global.initializeSettingsUiController = (args) => {
    settingsCalls.push(args);
    callOrder.push("settings");
  };

  global.formatUploadDateForDescription = () => "";
  global.formatChannelSubscribers = () => "";
  global.normalizeLiveChatBaseName = (value) => value;
  global.parseNdjsonMessages = () => [];
  global.getVideoIdFromFilename = () => "";
  global.createCommentRenderer = () => ({});
  global.createChatLineElementFromMessage = () => null;
  global.createHomeVideoBrowserController = () => ({});
  global.createPlayerUiController = () => ({});
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  global.navigator = { clipboard: { writeText: async () => {} } };
  global.alert = () => {};
  global.confirm = () => true;

  delete require.cache[require.resolve(appPath)];
  require(appPath);

  docListeners.get("DOMContentLoaded")();

  assert.deepEqual(callOrder, ["settings", "sse", "routing", "player"]);
  assert.equal(settingsCalls.length, 1);
  assert.equal(typeof settingsCalls[0].dependencies.fetchImpl, "function");
  assert.equal(typeof settingsCalls[0].dependencies.parseApiResponseImpl, "function");
});
