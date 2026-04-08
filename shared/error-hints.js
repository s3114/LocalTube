(function attachLocalTubeErrorHints(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  const api = factory();
  root.getLocalTubeErrorHints = api.getLocalTubeErrorHints;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function getLocalTubeErrorHints(errorMessage) {
    const text = String(errorMessage || "");
    const hints = [];

    if (text.includes("Sign in to confirm you’re not a bot")) {
      hints.push("Cookieファイルを指定し、再度ダウンロードを実行してください。");
    }
    if (text.includes("skipped as they are DRM protected")) {
      hints.push(
        "DRM保護の動画のトグルを有効にし再度ダウンロードを実行してください。",
      );
    }
    if (text.includes("Join this channel to get access to members")) {
      hints.push("正しいCookieファイルを指定し、再度ダウンロードを実行してください。");
    }
    if (text.includes("Requested format is not available")) {
      hints.push(
        "フォーマットが利用できません。ダウンロード通信をID固定を有効にしてみてください。うまくいかない場合は設定ページのinfoのサポートサーバーから質問してください。",
      );
    }
    if (text.includes("HTTP Error 403: Forbidden")) {
      hints.push(
        "情報不足にて確実な対処方法が確立していません。discordサーバーにて質問して下さい。",
      );
    }
    if (text.includes("Unsupported URL: ")) {
      hints.push("そのURLはサポートされていません。");
    }
    if (text.includes("' is not a valid URL")) {
      hints.push("URLが有効ではありません。");
    }

    return hints;
  }

  return {
    getLocalTubeErrorHints,
  };
});
