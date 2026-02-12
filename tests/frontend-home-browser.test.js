const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const homeBrowserPath = path.join(__dirname, "..", "public", "app-home-browser.js");

function setupHomeBrowserEnvironment() {
  global.window = global;
  global.getVideoIdFromFilename = (filename) =>
    String(filename || "").replace(/\.(mp4|mkv|webm|mov)$/i, "");
}

function loadHomeBrowser() {
  delete require.cache[require.resolve(homeBrowserPath)];
  require(homeBrowserPath);
}

test("home-browser utils normalize and parse duration", () => {
  setupHomeBrowserEnvironment();
  loadHomeBrowser();
  const utils = global.__homeBrowserTestUtils;

  assert.equal(utils.normalizeYyyymmdd("2024/05/31"), "20240531");
  assert.equal(utils.parseDurationInput("90"), 90);
  assert.equal(utils.parseDurationInput("03:30"), 210);
  assert.equal(utils.parseDurationInput("01:02:03"), 3723);
  assert.equal(utils.parseDurationInput("abc"), null);
});

test("home-browser utils match duration filters", () => {
  setupHomeBrowserEnvironment();
  loadHomeBrowser();
  const utils = global.__homeBrowserTestUtils;

  assert.equal(utils.matchesHomeDurationFilter({ duration: 100 }, { durationMode: "lt3" }), true);
  assert.equal(utils.matchesHomeDurationFilter({ duration: 200 }, { durationMode: "lt3" }), false);
  assert.equal(
    utils.matchesHomeDurationFilter({ duration: 600 }, { durationMode: "3to20" }),
    true,
  );
  assert.equal(
    utils.matchesHomeDurationFilter(
      { duration: 600 },
      { durationMode: "custom", durationMinSec: 500, durationMaxSec: 700 },
    ),
    true,
  );
});

test("home-browser utils filter videos by channel/date/terms", () => {
  setupHomeBrowserEnvironment();
  loadHomeBrowser();
  const utils = global.__homeBrowserTestUtils;

  const videos = [
    { filename: "a.mp4", title: "MIMI song", mtime: new Date("2024-05-31").getTime() },
    { filename: "b.mp4", title: "other", mtime: new Date("2023-01-01").getTime() },
  ];
  const homeInfoData = new Map([
    [
      "a",
      {
        channel: "MIMI",
        uploader: "MIMI",
        upload_date: "20240531",
        duration: 170,
        title: "MIMI - test",
      },
    ],
    [
      "b",
      {
        channel: "Else",
        uploader: "Else",
        upload_date: "20230101",
        duration: 1200,
        title: "Else - test",
      },
    ],
  ]);

  const filtered = utils.filterHomeVideosWithInputs(
    videos,
    homeInfoData,
    {
      channelKeyword: "mimi",
      fromYmd: "20240101",
      toYmd: "20241231",
      durationMode: "lt3",
      durationMinSec: null,
      durationMaxSec: null,
    },
    ["mimi"],
  );

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].filename, "a.mp4");
});
