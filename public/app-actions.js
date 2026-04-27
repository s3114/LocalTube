(function attachAppActions(global) {
  const SKIP_DOWNLOAD_CONFIRM_SETTING_KEY = "localtube.skipDownloadConfirm.v1";
  const DOWNLOAD_ESTIMATE_ENABLED_STORAGE_KEY = "optDownloadEstimates";
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

  function formatEstimateSummary(summary) {
    const totalText = String(summary?.totalText || "").trim();
    const count = Number(summary?.count || 0);
    if (!totalText) return "";
    return `予測サイズ: ${totalText}${count > 0 ? ` (${count}件)` : ""}`;
  }

  function buildEstimateLines(entries) {
    if (!Array.isArray(entries)) return [];
    return entries
      .map((entry) => {
        const title = String(entry?.title || entry?.url || "").trim();
        const size = String(entry?.estimatedSizeText || "不明").trim() || "不明";
        if (!title) return "";
        return `${title} - ${size}`;
      })
      .filter(Boolean);
  }

  function getEstimateToggleLabel(isCollapsed) {
    return isCollapsed ? "展開" : "折りたたむ";
  }

  function formatEstimateTotal(summary) {
    const totalText = String(summary?.totalText || "").trim();
    return totalText ? `合計: ${totalText}` : "";
  }

  function buildEstimateFailureItems(failures) {
    if (!Array.isArray(failures)) return [];
    return failures
      .map((failure) => {
        const error = String(failure?.error || "").trim();
        if (!error) return null;
        const errorHints = Array.isArray(failure?.errorHints)
          ? failure.errorHints
          : Array.isArray(global.getLocalTubeErrorHints?.(error))
            ? global.getLocalTubeErrorHints(error)
            : [];
        return {
          title: String(failure?.title || "").trim(),
          url: String(failure?.url || "").trim(),
          error,
          errorHints: errorHints
            .map((hint) => String(hint || "").trim())
            .filter(Boolean),
        };
      })
      .filter(Boolean);
  }

  function resolveEstimateSummaryLabel(summary, failures) {
    const formatted = formatEstimateSummary(summary);
    if (formatted) return formatted;
    return Array.isArray(failures) && failures.length > 0 ? "予測サイズ: 不明" : "";
  }

  function shouldCollapseEstimateList(lines) {
    return Array.isArray(lines) && lines.length >= 6;
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
    showDownloadConfirm = async () => ({ confirmed: true, skipFuture: false }),
    loadSetting = (key, defaultValue) =>
      typeof global.loadLocalSetting === "function"
        ? global.loadLocalSetting(key, defaultValue)
        : defaultValue,
    saveSetting = (key, value) => {
      if (typeof global.saveLocalSetting === "function") {
        global.saveLocalSetting(key, value);
      }
    },
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

    function setEstimateLoadingVisible(visible) {
      const backdrop = doc.getElementById("estimate-loading-backdrop");
      if (!backdrop?.classList) return;
      if (visible) {
        backdrop.classList.remove("hidden");
      } else {
        backdrop.classList.add("hidden");
      }
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

    function updateEstimateStatus(message) {
      const statusEl = doc.getElementById("download-estimate-status");
      if (!statusEl) return;
      statusEl.textContent = String(message || "").trim();
    }

    function clearEstimateUi() {
      updateEstimateStatus("");
      const sectionEl = doc.getElementById("download-estimate-list-section");
      const totalEl = doc.getElementById("download-estimate-list-total");
      const listEl = doc.getElementById("download-estimate-list");
      const toggleBtn = doc.getElementById("download-estimate-list-toggle");
      if (totalEl) totalEl.textContent = "";
      if (listEl) {
        listEl.innerHTML = "";
        listEl.classList.remove("collapsed");
      }
      if (toggleBtn) {
        toggleBtn.textContent = getEstimateToggleLabel(false);
        toggleBtn.classList.add("hidden");
      }
      sectionEl?.classList.add("hidden");
    }

    function updateEstimateList(entries, summary) {
      const sectionEl = doc.getElementById("download-estimate-list-section");
      const totalEl = doc.getElementById("download-estimate-list-total");
      const listEl = doc.getElementById("download-estimate-list");
      const toggleBtn = doc.getElementById("download-estimate-list-toggle");
      if (!sectionEl || !listEl) return;

      const lines = buildEstimateLines(entries);
      listEl.innerHTML = "";
      if (lines.length === 0) {
        sectionEl.classList.add("hidden");
        return;
      }

      if (totalEl) {
        totalEl.textContent = formatEstimateTotal(summary);
      }

      const fragment = doc.createDocumentFragment
        ? doc.createDocumentFragment()
        : null;
      lines.forEach((line) => {
        const item = doc.createElement("div");
        item.className = "download-estimate-list-item";
        item.textContent = line;
        if (fragment) {
          fragment.appendChild(item);
        } else {
          listEl.appendChild(item);
        }
      });
      if (fragment) {
        listEl.appendChild(fragment);
      }
      if (toggleBtn) {
        const shouldCollapse = shouldCollapseEstimateList(lines);
        listEl.classList.toggle("collapsed", shouldCollapse);
        const isCollapsed = listEl.classList.contains("collapsed");
        toggleBtn.textContent = getEstimateToggleLabel(isCollapsed);
        toggleBtn.classList.toggle("hidden", lines.length <= 1);
      }
      sectionEl.classList.remove("hidden");
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

    function appendEstimateEntries(formData, estimateData) {
      const entries = Array.isArray(estimateData?.entries) ? estimateData.entries : [];
      formData.append("estimateEntriesJson", JSON.stringify(entries));
      const failures = Array.isArray(estimateData?.failures) ? estimateData.failures : [];
      formData.append("estimateFailuresJson", JSON.stringify(failures));
    }

    async function fetchDownloadEstimate(formData) {
      const response = await fetchImpl("/api/download-estimate", {
        method: "POST",
        body: formData,
      });
      return parseApiResponse(response);
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
      if (result.ok) return { ok: true, mode: "download", data: result.data || null };

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

        const formData = buildDownloadFormData(urlsInput);
        if (isFormatReportMode) {
          clearEstimateUi();
          setFormatReportLoadingVisible(true);
          const submitResult = await submitDownload(formData);
          if (!submitResult.ok) return;
          if (submitResult.mode === "report") {
            notifyInfo("フォーマットレポートをダウンロードしました。");
          } else {
            notifyInfo("ダウンロードを開始しました。");
          }
          urlsInput.value = "";
          return;
        }

        const estimatesEnabled =
          loadSetting(DOWNLOAD_ESTIMATE_ENABLED_STORAGE_KEY, true) !== false;
        let estimateResult = { ok: true, data: { entries: [], failures: [], summary: null } };
        let estimateLabel = "";
        let estimateFailures = [];
        if (estimatesEnabled) {
          const estimateFormData = buildDownloadFormData(urlsInput);
          setEstimateLoadingVisible(true);
          estimateResult = await fetchDownloadEstimate(estimateFormData);
          setEstimateLoadingVisible(false);
          if (!estimateResult.ok) {
            notifyError(`エラー: ${estimateResult.error || "サイズ見積もりに失敗しました。"}`);
              return;
            }

          estimateFailures = buildEstimateFailureItems(estimateResult.data?.failures);
          estimateLabel = resolveEstimateSummaryLabel(
            estimateResult.data?.summary,
            estimateFailures,
          );
          updateEstimateStatus(estimateLabel);
          updateEstimateList(
            estimateResult.data?.entries,
            estimateResult.data?.summary,
          );
        } else {
          clearEstimateUi();
        }

        const skipConfirm =
          loadSetting(SKIP_DOWNLOAD_CONFIRM_SETTING_KEY, false) === true;
        if (!skipConfirm) {
          const confirmResult = await showDownloadConfirm({
            message: "ダウンロードを開始しますか？",
            estimateText: estimateLabel,
            failures: estimateFailures,
          });
          if (!confirmResult?.confirmed) return;
          if (confirmResult.skipFuture) {
            saveSetting(SKIP_DOWNLOAD_CONFIRM_SETTING_KEY, true);
          }
        }

        appendEstimateEntries(formData, estimateResult.data);
        const submitResult = await submitDownload(formData);
        if (submitResult.ok) {
          const queuedCount = Number(submitResult.data?.queuedCount || 0);
          const skippedCount = Number(
            submitResult.data?.skippedEstimateFailureCount || 0,
          );
          if (queuedCount > 0 && skippedCount > 0) {
            notifyInfo(
              `ダウンロードを開始しました。${skippedCount}件はサイズ見積もりエラーのため除外しました。`,
            );
          } else if (queuedCount > 0) {
            notifyInfo("ダウンロードを開始しました。");
          } else if (skippedCount > 0) {
            notifyInfo(
              `${skippedCount}件はサイズ見積もりエラーのためダウンロードしませんでした。`,
            );
          }
          urlsInput.value = "";
        }
      } catch (error) {
        notifyError(`ネットワークエラーまたは検証中に問題が発生しました: ${error.message}`);
        onError(error);
      } finally {
        setEstimateLoadingVisible(false);
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
    formatEstimateSummary,
    formatEstimateTotal,
    DOWNLOAD_ESTIMATE_ENABLED_STORAGE_KEY,
    extractFilenameFromDisposition,
    isAttachmentResponse,
    hasListFormatsCommand,
  };
})(window);
