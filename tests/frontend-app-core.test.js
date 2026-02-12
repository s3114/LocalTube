const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const corePath = path.join(__dirname, "..", "public", "app-core.js");

function setupCoreEnvironment() {
  const store = new Map();
  global.window = global;
  global.document = {
    createElement() {
      return {
        textContent: "",
        innerHTML: "",
        appendChild() {},
      };
    },
  };
  global.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  };
}

function loadCore() {
  delete require.cache[require.resolve(corePath)];
  require(corePath);
}

test("createAppCore.parseApiResponse handles API envelope", async () => {
  setupCoreEnvironment();
  loadCore();

  const core = global.createAppCore({ jobStates: new Map() });
  const response = {
    ok: true,
    status: 200,
    async json() {
      return { ok: true, data: { value: 1 }, error: null };
    },
  };

  const parsed = await core.parseApiResponse(response);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.data, { value: 1 });
  assert.equal(parsed.error, null);
});

test("createAppCore.parseApiResponse handles non-envelope error payload", async () => {
  setupCoreEnvironment();
  loadCore();

  const core = global.createAppCore({ jobStates: new Map() });
  const response = {
    ok: false,
    status: 400,
    async json() {
      return { message: "bad request" };
    },
  };

  const parsed = await core.parseApiResponse(response);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.error, "bad request");
});

test("normalizeDirListForUi trims and deduplicates", () => {
  setupCoreEnvironment();
  loadCore();

  const normalized = global.normalizeDirListForUi([
    " C:\\Videos ",
    "",
    "C:\\Videos",
    "D:\\Archive",
  ]);

  assert.deepEqual(normalized, ["C:\\Videos", "D:\\Archive"]);
});

