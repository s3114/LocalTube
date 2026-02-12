const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const routingPath = path.join(__dirname, "..", "public", "app-routing.js");

function createClassList() {
  const classes = new Set();
  return {
    add(name) {
      classes.add(name);
    },
    remove(name) {
      classes.delete(name);
    },
    has(name) {
      return classes.has(name);
    },
  };
}

function setupRoutingEnvironment({ hash = "" } = {}) {
  global.window = global;
  global.location = { hash };

  const pushStateCalls = [];
  global.history = {
    pushState(_state, _title, url) {
      pushStateCalls.push(url);
      global.location.hash = String(url || "").replace(/^.*#/, "#");
    },
  };

  const listeners = [];
  global.addEventListener = (name, fn) => {
    listeners.push({ name, fn });
  };

  const headerSearchWrap = { style: { display: "" } };
  const pageDownloader = { id: "page-downloader", classList: createClassList() };
  const pageHome = { id: "page-home", classList: createClassList() };
  const pagePlayer = { id: "page-player", classList: createClassList() };
  const pageSettings = { id: "page-settings", classList: createClassList() };
  const pages = [pageDownloader, pageHome, pagePlayer, pageSettings];

  function createButton(pageId) {
    const handlers = [];
    return {
      dataset: { page: pageId },
      classList: createClassList(),
      addEventListener(name, fn) {
        if (name === "click") handlers.push(fn);
      },
      click() {
        handlers.forEach((fn) => fn());
      },
    };
  }

  const buttons = [
    createButton("page-downloader"),
    createButton("page-home"),
    createButton("page-player"),
    createButton("page-settings"),
  ];

  const pageById = new Map(pages.map((page) => [page.id, page]));
  global.document = {
    querySelectorAll(selector) {
      if (selector === ".icon-btn") return buttons;
      if (selector === ".page") return pages;
      return [];
    },
    querySelector(selector) {
      if (selector === ".header-search-wrap") return headerSearchWrap;
      return null;
    },
    getElementById(id) {
      return pageById.get(id) || null;
    },
  };

  global.updateSmoothSeekLoopState = () => {};

  return {
    buttons,
    pages,
    pageHome,
    pagePlayer,
    headerSearchWrap,
    listeners,
    pushStateCalls,
  };
}

function loadRouting() {
  delete require.cache[require.resolve(routingPath)];
  require(routingPath);
}

test("routing initializes from hash and stores pending player id", () => {
  const env = setupRoutingEnvironment({ hash: "#player/abc%20123" });
  loadRouting();
  const appState = {};

  const routing = global.createHeaderRoutingController({ appState });
  routing.initialize();

  assert.equal(env.pagePlayer.classList.has("active-page"), true);
  assert.equal(env.pageHome.classList.has("active-page"), false);
  assert.equal(env.headerSearchWrap.style.display, "none");
  assert.equal(appState.pendingVideoId, "abc 123");
  assert.ok(env.listeners.some((item) => item.name === "popstate"));
});

test("routing click updates hash, active page and search visibility", () => {
  const env = setupRoutingEnvironment({ hash: "#downloader" });
  loadRouting();
  const appState = {};

  const routing = global.createHeaderRoutingController({ appState });
  routing.initialize();
  env.buttons[1].click();

  assert.equal(env.pushStateCalls.at(-1), "#home");
  assert.equal(env.pageHome.classList.has("active-page"), true);
  assert.equal(env.pagePlayer.classList.has("active-page"), false);
  assert.equal(env.headerSearchWrap.style.display, "flex");
});

test("routing utils resolve hash into pageId and params", () => {
  setupRoutingEnvironment({ hash: "#downloader" });
  loadRouting();
  const utils = global.__appRoutingTestUtils;

  assert.deepEqual(utils.resolvePageIdFromHash("#home"), {
    page: "home",
    videoId: undefined,
    pageId: "page-home",
  });
  assert.deepEqual(utils.resolvePageIdFromHash("#player/abc"), {
    page: "player",
    videoId: "abc",
    pageId: "page-player",
  });
  assert.equal(utils.resolvePageIdFromHash("#unknown").pageId, "page-downloader");
});
