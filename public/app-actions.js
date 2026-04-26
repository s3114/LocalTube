(function attachAppActions(global) {
  const COOKIE_MODE_STORAGE_KEY = "localtube.cookieMode";
  const COOKIE_UPDATED_AT_STORAGE_KEY = "localtube.cookieUpdatedAt";

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

  function resolveCommentOptions({
    downloadComments = true,
    downloadChat = true,
  } = {}) {
    if (downloadComments && downloadChat) return "both";
    if (downloadComments) return "comments";
    if (downloadChat) return "sub";
    return "none";
  }

  function loadLocalSettingValue(key, defaultValue) {
    if (typeof global.loadLocalSetting === "function") {
      return global.loadLocalSetting(key, defaultValue);
    }
    return defaultValue;
  }

  function splitCustomCommandArgs(commandText) {
    const text = String(commandText || "").trim();
    if (!text) return [];

    const args = [];
    let current = "";
    let quote = null;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (char === "\\" && quote && next === quote) {
        current += next;
        index += 1;
        continue;
      }

      if ((char === '"' || char === "'")) {
        if (!quote) {
          quote = char;
          continue;
        }
        if (quote === char) {
          quote = null;
          continue;
        }
      }

      if (!quote && /\s/.test(char)) {
        if (current) {
          args.push(current);
          current = "";
        }
        continue;
      }

      current += char;
    }

    if (current) {
      args.push(current);
    }

    return args;
  }

  function hasListFormatsCommand(commandText) {
    return splitCustomCommandArgs(commandText).some(
      (arg) => arg === "--list-formats" || arg === "-F",
    );
  }

  function readCookieSelectionMetadata() {
    const mode = loadLocalSettingValue(COOKIE_MODE_STORAGE_KEY, "none");
    const updatedAt = loadLocalSettingValue(COOKIE_UPDATED_AT_STORAGE_KEY, "");
    let updatedAtLocal = "";

    if (updatedAt) {
      const date = new Date(updatedAt);
      if (!Number.isNaN(date.getTime())) {
        const yyyy = date.getFullYear();
        const MM = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");
        const hh = String(date.getHours()).padStart(2, "0");
        const mm = String(date.getMinutes()).padStart(2, "0");
        const ss = String(date.getSeconds()).padStart(2, "0");
        updatedAtLocal = `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
      }
    }

    return {
      mode,
      updatedAt,
      updatedAtLocal,
    };
  }

  function readBrowserBrands() {
    const brands = global.navigator?.userAgentData?.brands;
    if (!Array.isArray(brands)) return [];
    return brands
      .map((entry) => String(entry?.brand || "").trim())
      .filter(Boolean);
  }

  function extractFilenameFromDisposition(dispositionValue) {
    const raw = String(dispositionValue || "");
    if (!raw) return "";
    const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        return utf8Match[1];
      }
    }
    const simpleMatch = raw.match(/filename="?([^"]+)"?/i);
    return simpleMatch ? simpleMatch[1] : "";
  }

  function buildDownloadSettingsSnapshot(doc) {
    const fmtEl = doc.getElementById("fmt");
    return {
      formatValue: fmtEl?.value || "",
      formatText: fmtEl?.options?.[fmtEl.selectedIndex]?.textContent || "",
      savePath: doc.getElementById("savePath")?.value || "",
      saveHistory: Boolean(doc.getElementById("optHistory")?.checked),
      downloadThumb: Boolean(doc.getElementById("optThumb")?.checked),
      embedThumbnail: Boolean(doc.getElementById("optEmbedThumbnail")?.checked),
      addMetadata: Boolean(doc.getElementById("optAddMetadata")?.checked),
      remuxVideo: Boolean(doc.getElementById("optRemuxVideo")?.checked),
      staticFormat: Boolean(doc.getElementById("optStaticFormat")?.checked),
      forceIpv4: Boolean(doc.getElementById("optForceIpv4")?.checked),
      drmProtect: Boolean(doc.getElementById("optDrm")?.checked),
      parallelDownloads: doc.getElementById("optParallelDownloads")?.value || "",
      concurrentFragments: doc.getElementById("optConcurrentFragments")?.value || "",
      downloadComments: Boolean(doc.getElementById("optDownloadComments")?.checked),
      downloadChat: Boolean(doc.getElementById("optDownloadChat")?.checked),
      downloadVideo: Boolean(doc.getElementById("optDownloadVideo")?.checked),
    };
  }

  function isAttachmentResponse(response) {
    const disposition = response?.headers?.get?.("content-disposition") || "";
    return /attachment/i.test(String(disposition));
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
    downloadAttachmentResponse = async (
      response,
      fallbackFilename = "localtube-report.html",
    ) => {
      const blob = await response.blob();
      const objectUrl = global.URL.createObjectURL(blob);
      const downloadLink = global.document.createElement("a");
      downloadLink.href = objectUrl;
      downloadLink.download =
        extractFilenameFromDisposition(
          response.headers?.get?.("content-disposition"),
        ) || fallbackFilename;
      global.document.body.appendChild(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      global.URL.revokeObjectURL(objectUrl);
    },
  }) {
    function setButtonDisabled(button, disabled) {
      if (button) button.disabled = disabled;
    }

    function setFormatReportLoadingVisible(visible) {
      const backdrop = doc.getElementById("format-report-loading-backdrop");
      if (!backdrop?.classList) return;
      if (visible) {
        backdrop.classList.remove("hidden");
      } else {
        backdrop.classList.add("hidden");
      }
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
      const downloadComments =
        doc.getElementById("optDownloadComments")?.checked ?? true;
      const downloadChat = doc.getElementById("optDownloadChat")?.checked ?? true;
      const downloadVideo = doc.getElementById("optDownloadVideo")?.checked ?? true;
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
      formData.append(
        "commentOptions",
        resolveCommentOptions({ downloadComments, downloadChat }),
      );
      formData.append("downloadComments", downloadComments);
      formData.append("downloadChat", downloadChat);
      formData.append("downloadVideo", downloadVideo);
      formData.append("currentUrl", global.location?.href || "");
      formData.append("browserUserAgent", global.navigator?.userAgent || "");
      formData.append("browserBrands", JSON.stringify(readBrowserBrands()));
      formData.append("generatedAt", new Date().toISOString());
      formData.append(
        "cookieInfo",
        JSON.stringify(readCookieSelectionMetadata()),
      );
      formData.append(
        "downloadSettings",
        JSON.stringify(buildDownloadSettingsSnapshot(doc)),
      );

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
      if (response?.ok && isAttachmentResponse(response)) {
        await downloadAttachmentResponse(
          response,
          "localtube-report-formats.html",
        );
        return { ok: true, mode: "report" };
      }
      const result = await parseApiResponse(response);
      if (result.ok) return { ok: true, mode: "download" };

      notifyError(`エラー: ${result.error || "ダウンロードの開始に失敗しました。"}`);
      return { ok: false, mode: "download" };
    }

    async function startDownload() {
      const downloadBtn = doc.getElementById("download-btn");
      const urlsInput = doc.getElementById("urls");
      const customCommandInput = doc.getElementById("yt-dlp-custom-command-input");
      const downloadComments =
        doc.getElementById("optDownloadComments")?.checked ?? true;
      const downloadChat = doc.getElementById("optDownloadChat")?.checked ?? true;
      const downloadVideo = doc.getElementById("optDownloadVideo")?.checked ?? true;
      const isFormatReportMode = hasListFormatsCommand(customCommandInput?.value);
      setButtonDisabled(downloadBtn, true);

      try {
        if (!downloadComments && !downloadChat && !downloadVideo) {
          return;
        }

        const urls = parseInputUrls(urlsInput);
        if (!urls) return;

        const valid = await validateUrls(urls);
        if (!valid) return;

        if (isFormatReportMode) {
          setFormatReportLoadingVisible(true);
        }

        const formData = buildDownloadFormData(urlsInput);
        const submitResult = await submitDownload(formData);
        if (submitResult.ok) {
          if (submitResult.mode === "report") {
            notifyInfo("フォーマットレポートをダウンロードしました。");
          } else {
            notifyInfo("ダウンロードを開始しました。");
          }
          urlsInput.value = "";
        }
      } catch (error) {
        notifyError(`ネットワークエラーまたは検証中に問題が発生しました: ${error.message}`);
        onError(error);
      } finally {
        setFormatReportLoadingVisible(false);
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
    resolveCommentOptions,
    extractFilenameFromDisposition,
    isAttachmentResponse,
    hasListFormatsCommand,
  };
})(window);
