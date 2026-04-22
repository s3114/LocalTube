(function attachAppActions(global) {
  const SKIP_DOWNLOAD_CONFIRM_SETTING_KEY = "localtube.skipDownloadConfirm.v1";
  const DOWNLOAD_ESTIMATE_ENABLED_STORAGE_KEY = "optDownloadEstimates";

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

  function shouldCollapseEstimateList(lines) {
    return Array.isArray(lines) && lines.length >= 6;
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
  }) {
    function setButtonDisabled(button, disabled) {
      if (button) button.disabled = disabled;
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

      const cookieFile = getSelectedCookieFile();
      if (cookieFile) {
        formData.append("cookieFile", cookieFile);
      }
      return formData;
    }

    function appendEstimateEntries(formData, estimateData) {
      const entries = Array.isArray(estimateData?.entries) ? estimateData.entries : [];
      formData.append("estimateEntriesJson", JSON.stringify(entries));
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
      const result = await parseApiResponse(response);
      if (result.ok) return true;

      notifyError(`エラー: ${result.error || "ダウンロードの開始に失敗しました。"}`);
      return false;
    }

    async function startDownload() {
      const downloadBtn = doc.getElementById("download-btn");
      const urlsInput = doc.getElementById("urls");
      const downloadComments =
        doc.getElementById("optDownloadComments")?.checked ?? true;
      const downloadChat = doc.getElementById("optDownloadChat")?.checked ?? true;
      const downloadVideo = doc.getElementById("optDownloadVideo")?.checked ?? true;
      setButtonDisabled(downloadBtn, true);

      try {
        if (!downloadComments && !downloadChat && !downloadVideo) {
          return;
        }

        const urls = parseInputUrls(urlsInput);
        if (!urls) return;

        const valid = await validateUrls(urls);
        if (!valid) return;

        const estimatesEnabled = loadSetting(DOWNLOAD_ESTIMATE_ENABLED_STORAGE_KEY, true) !== false;
        let estimateResult = { ok: true, data: { entries: [], summary: null } };
        let estimateLabel = "";
        if (estimatesEnabled) {
          const estimateFormData = buildDownloadFormData(urlsInput);
          estimateResult = await fetchDownloadEstimate(estimateFormData);
          if (!estimateResult.ok) {
            notifyError(`エラー: ${estimateResult.error || "サイズ見積もりに失敗しました。"}`);
            return;
          }

          estimateLabel = formatEstimateSummary(estimateResult.data?.summary);
          updateEstimateStatus(estimateLabel);
          updateEstimateList(estimateResult.data?.entries, estimateResult.data?.summary);
        } else {
          clearEstimateUi();
        }

        const skipConfirm = loadSetting(SKIP_DOWNLOAD_CONFIRM_SETTING_KEY, false) === true;
        if (!skipConfirm) {
          const confirmResult = await showDownloadConfirm({
            message: "ダウンロードを開始しますか？",
            estimateText: estimateLabel,
          });
          if (!confirmResult?.confirmed) return;
          if (confirmResult.skipFuture) {
            saveSetting(SKIP_DOWNLOAD_CONFIRM_SETTING_KEY, true);
          }
        }

        const formData = buildDownloadFormData(urlsInput);
        appendEstimateEntries(formData, estimateResult.data);
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
    resolveCommentOptions,
    formatEstimateSummary,
    formatEstimateTotal,
    DOWNLOAD_ESTIMATE_ENABLED_STORAGE_KEY,
  };
})(window);
