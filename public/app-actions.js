(function attachAppActions(global) {
  function parseUrlsFromInputValue(value) {
    const rawUrls = String(value || "").trim();
    if (rawUrls === "") {
      return { ok: false, errorCode: "EMPTY_URLS", urls: [] };
    }

    const urls = rawUrls.split(/[\n\s,]+/).filter((url) => url.trim() !== "");
    if (urls.length === 0) {
      return { ok: false, errorCode: "EMPTY_URLS", urls: [] };
    }

    return { ok: true, errorCode: null, urls };
  }

  function isHttpsUrl(url) {
    return String(url || "").startsWith("https://");
  }

  function createDownloadActions({
    parseApiResponse,
    fetchImpl = fetch,
    doc = document,
    alertImpl = alert,
    notifyInfo = () => {},
    notifyError = (message) => alertImpl(message),
    getSelectedCookieFile = () => global.selectedCookieFile,
    onError = (error) => console.error("Fetch error:", error),
  }) {
    function setButtonDisabled(button, disabled) {
      if (button) button.disabled = disabled;
    }

    function parseInputUrls(urlsInput) {
      const parsed = parseUrlsFromInputValue(urlsInput?.value);
      if (!parsed.ok) {
        notifyError("URLを入力してください。");
        return null;
      }
      return parsed.urls;
    }

    async function validateSingleUrl(url) {
      if (!isHttpsUrl(url)) {
        notifyError(
          `「${url}」は有効なURLではありません。https:// で始まるURLを入力してください。`,
        );
        return false;
      }

      const validationResponse = await fetchImpl(
        `/api/validate-url?url=${encodeURIComponent(url)}`,
      );
      const validationResult = await parseApiResponse(validationResponse);
      const validationData = validationResult.data || {};
      if (validationData.isValid) return true;
      const errorMessage = validationData.error || validationResult.error || "";

      notifyError(
        `「${url}」はアクセスできません。${errorMessage ? `エラー: ${errorMessage}` : ""}`,
      );
      return false;
    }

    async function validateUrls(urls) {
      for (const url of urls) {
        const valid = await validateSingleUrl(url);
        if (!valid) return false;
      }
      return true;
    }

    function buildDownloadFormData(urlsInput) {
      const formData = new FormData();
      formData.append("urls", urlsInput.value);
      formData.append("format", doc.getElementById("fmt").value);
      formData.append("saveHistory", doc.getElementById("optHistory").checked);
      formData.append("downloadThumb", doc.getElementById("optThumb").checked);
      formData.append(
        "embedThumbnail",
        doc.getElementById("optEmbedThumbnail")?.checked ?? true,
      );
      formData.append(
        "addMetadata",
        doc.getElementById("optAddMetadata")?.checked ?? true,
      );
      formData.append(
        "remuxVideo",
        doc.getElementById("optRemuxVideo")?.checked ?? false,
      );
      formData.append(
        "forceIpv4",
        doc.getElementById("optForceIpv4")?.checked ?? false,
      );
      formData.append("drmProtect", doc.getElementById("optDrm").checked);
      formData.append("savePath", doc.getElementById("savePath").value);
      formData.append(
        "parallelDownloads",
        doc.getElementById("optParallelDownloads").value,
      );
      formData.append(
        "concurrentFragments",
        doc.getElementById("optConcurrentFragments").value,
      );
      formData.append("commentOptions", doc.getElementById("comment-options").value);

      const cookieFile = getSelectedCookieFile();
      if (cookieFile) {
        formData.append("cookieFile", cookieFile);
      }
      return formData;
    }

    async function submitDownload(formData) {
      const response = await fetchImpl("/download", {
        method: "POST",
        body: formData,
      });
      const result = await parseApiResponse(response);
      if (result.ok) return true;

      notifyError(`エラー: ${result.error || "ダウンロードの開始に失敗しました。"}`);
      return false;
    }

    async function startDownload() {
      const downloadBtn = doc.getElementById("download-btn");
      const urlsInput = doc.getElementById("urls");
      setButtonDisabled(downloadBtn, true);

      try {
        const urls = parseInputUrls(urlsInput);
        if (!urls) return;

        const valid = await validateUrls(urls);
        if (!valid) return;

        const formData = buildDownloadFormData(urlsInput);
        const submitted = await submitDownload(formData);
        if (submitted) {
          notifyInfo("ダウンロードを開始しました。");
          urlsInput.value = "";
        }
      } catch (error) {
        notifyError(`ネットワークエラーまたは検証中に問題が発生しました: ${error.message}`);
        onError(error);
      } finally {
        setButtonDisabled(downloadBtn, false);
      }
    }

    return {
      startDownload,
    };
  }

  global.createDownloadActions = createDownloadActions;
  global.__appActionsTestUtils = {
    parseUrlsFromInputValue,
    isHttpsUrl,
  };
})(window);
