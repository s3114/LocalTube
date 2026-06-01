const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const settingsUiPath = path.join(__dirname, "..", "public", "app-settings-ui.js");

function loadSettingsUi() {
  global.window = global;
  delete require.cache[require.resolve(settingsUiPath)];
  require(settingsUiPath);
}

test("settings-ui status helper updates message and tone color", () => {
  loadSettingsUi();
  const utils = global.__settingsUiTestUtils;
  const el = { textContent: "", style: { color: "" } };

  utils.setSettingStatus(el, "保存中...", "info");
  assert.equal(el.textContent, "保存中...");
  assert.equal(el.style.color, "var(--blue)");

  utils.setSettingStatus(el, "保存しました", "success");
  assert.equal(el.style.color, "var(--green)");

  utils.setSettingStatus(el, "保存失敗", "error");
  assert.equal(el.style.color, "var(--accent)");
});

test("settings-ui local video dirs and fallback status reflect settings", () => {
  loadSettingsUi();
  const utils = global.__settingsUiTestUtils;

  const elements = {
    localVideoDirsInput: { value: "" },
    localVideoDirsStatus: { textContent: "", style: { color: "" } },
    optFallbackThumbnails: { checked: false },
    fallbackThumbStatus: { textContent: "", style: { color: "" } },
  };

  utils.applyLocalVideoDirsFromServer(elements, {
    localVideoDirs: ["C:\\videos\\a", "C:\\videos\\b"],
  });
  assert.equal(elements.localVideoDirsInput.value, "C:\\videos\\a\nC:\\videos\\b");
  assert.equal(elements.localVideoDirsStatus.textContent, "2 件のフォルダーを登録中");
  assert.equal(elements.localVideoDirsStatus.style.color, "var(--subtext)");

  utils.applyFallbackThumbnailSettingFromServer(elements, {
    enableFallbackThumbnails: false,
  });
  assert.equal(elements.optFallbackThumbnails.checked, false);
  assert.equal(elements.fallbackThumbStatus.textContent, "無効です");
  assert.equal(elements.fallbackThumbStatus.style.color, "var(--subtext)");
});

test("settings-ui local video status text builder returns expected labels", () => {
  loadSettingsUi();
  const utils = global.__settingsUiTestUtils;

  assert.equal(utils.buildLocalVideoDirsStatusText(["a"]), "1 件のフォルダーを登録しました");
  assert.equal(utils.buildLocalVideoDirsStatusText([]), "追加フォルダーをクリアしました");
});

test("settings-ui autostart view disables unsupported platforms", () => {
  loadSettingsUi();
  const utils = global.__settingsUiTestUtils;

  assert.deepEqual(utils.buildAutostartStatusView({
    enabled: false,
    mode: "unsupported",
    supported: false,
    message: "Windows専用です。",
  }), {
    mode: "disabled",
    disabled: true,
    text: "Windows専用です。",
    color: "var(--subtext)",
  });

  assert.deepEqual(utils.buildAutostartStatusView({
    enabled: true,
    mode: "logon",
    supported: true,
  }), {
    mode: "logon",
    disabled: false,
    text: "現在: ログオン時",
    color: "var(--green)",
  });
});
