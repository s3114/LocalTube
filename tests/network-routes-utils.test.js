const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractChannelIdFromHtml,
  isSupportedYoutubeResolveUrl,
} = require("../server/routes/network-routes");

test("network-routes utils accept handle, channel, and watch URLs", () => {
  assert.equal(isSupportedYoutubeResolveUrl("https://www.youtube.com/@AmaneKanata"), true);
  assert.equal(isSupportedYoutubeResolveUrl("https://www.youtube.com/@AmaneKanata/"), true);
  assert.equal(
    isSupportedYoutubeResolveUrl("https://www.youtube.com/channel/UCZlDXzGoo7d44bwdNObFacg"),
    true,
  );
  assert.equal(
    isSupportedYoutubeResolveUrl("https://www.youtube.com/watch?v=b2aWJdkFPKQ"),
    true,
  );
  assert.equal(isSupportedYoutubeResolveUrl("https://youtu.be/b2aWJdkFPKQ"), true);
  assert.equal(isSupportedYoutubeResolveUrl("https://example.com/not-youtube"), false);
});

test("network-routes utils extract channelId from canonical channel url", () => {
  const html =
    '<html><head><link rel="canonical" href="https://www.youtube.com/channel/UCZlDXzGoo7d44bwdNObFacg"></head></html>';
  assert.equal(extractChannelIdFromHtml(html), "UCZlDXzGoo7d44bwdNObFacg");
});

test("network-routes utils extract channelId from watch page metadata", () => {
  const html =
    '<html><body>{"channelId":"UCZlDXzGoo7d44bwdNObFacg","title":"sample"}</body></html>';
  assert.equal(extractChannelIdFromHtml(html), "UCZlDXzGoo7d44bwdNObFacg");
});
