const appState = window.AppState || {
  pendingVideoId: null,
  jobStates: new Map(),
};

      // --- Global State ---
      const jobStates = appState.jobStates;

      // --- Helper Functions ---
      const appCore = window.createAppCore({ jobStates });
      const { renderJob, updateJobElement, parseApiResponse, linkifyText } = appCore;
      const perfMetrics = new Map();
      window.recordPerfMetric = (name, value, meta = {}) => {
        if (!Number.isFinite(value)) return;
        const key = String(name || "unknown");
        if (!perfMetrics.has(key)) perfMetrics.set(key, []);
        const list = perfMetrics.get(key);
        list.push(Number(value));
        if (list.length > 30) list.shift();
        const sorted = [...list].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const p50 = sorted[mid];
        const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
        console.debug(`[perf] ${key}`, {
          latest: Math.round(value),
          p50: Math.round(p50),
          p95: Math.round(p95),
          samples: sorted.length,
          ...meta,
        });
      };
      window.getPerfMetricSummary = () => {
        const summary = {};
        for (const [key, list] of perfMetrics.entries()) {
          if (list.length === 0) continue;
          const sorted = [...list].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          summary[key] = {
            samples: sorted.length,
            min: Math.round(sorted[0]),
            p50: Math.round(sorted[mid]),
            p95: Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
            max: Math.round(sorted[sorted.length - 1]),
          };
        }
        return summary;
      };
      const uiFeedback = window.createUiFeedback?.() || {
        showInfo: () => {},
        showSuccess: () => {},
        showError: () => {},
      };
      const settingsConfirmModalElements = {
        backdrop: document.getElementById("settings-confirm-modal-backdrop"),
        message: document.getElementById("settings-confirm-modal-message"),
        cancelBtn: document.getElementById("settings-confirm-modal-cancel-btn"),
        confirmBtn: document.getElementById("settings-confirm-modal-confirm-btn"),
      };
      const downloadConfirmModalElements = {
        backdrop: document.getElementById("download-confirm-modal-backdrop"),
        message: document.getElementById("download-confirm-modal-message"),
        estimate: document.getElementById("download-confirm-modal-estimate"),
        errors: document.getElementById("download-confirm-modal-errors"),
        errorsCopy: document.getElementById("download-confirm-modal-errors-copy"),
        errorsList: document.getElementById("download-confirm-modal-errors-list"),
        skipCheckbox: document.getElementById("download-confirm-modal-skip-checkbox"),
        cancelBtn: document.getElementById("download-confirm-modal-cancel-btn"),
        confirmBtn: document.getElementById("download-confirm-modal-confirm-btn"),
      };
      const failedUrlModalElements = {
        openBtn: document.getElementById("open-failed-url-modal-btn"),
        backdrop: document.getElementById("failed-url-modal-backdrop"),
        copy: document.getElementById("failed-url-modal-copy"),
        preview: document.getElementById("failed-url-modal-preview"),
        cancelBtn: document.getElementById("failed-url-modal-cancel-btn"),
        copyBtn: document.getElementById("failed-url-modal-copy-btn"),
        exportBtn: document.getElementById("failed-url-modal-export-btn"),
        autofillBtn: document.getElementById("failed-url-modal-autofill-btn"),
      };

      function showSettingsConfirmModal(message, options = {}) {
        const {
          backdrop,
          message: messageEl,
          cancelBtn,
          confirmBtn,
        } = settingsConfirmModalElements;
        if (!backdrop || !messageEl || !cancelBtn || !confirmBtn) {
          return Promise.resolve(window.confirm(String(message || "")));
        }

        const confirmLabel = String(options.confirmText || "はい");
        const cancelLabel = String(options.cancelText || "いいえ");
        const previousConfirmText = confirmBtn.textContent;
        const previousCancelText = cancelBtn.textContent;
        messageEl.textContent = String(message || "");
        confirmBtn.textContent = confirmLabel;
        cancelBtn.textContent = cancelLabel;
        backdrop.classList.remove("hidden");

        return new Promise((resolve) => {
          let settled = false;
          const cleanup = (result) => {
            if (settled) return;
            settled = true;
            backdrop.classList.add("hidden");
            confirmBtn.textContent = previousConfirmText;
            cancelBtn.textContent = previousCancelText;
            confirmBtn.removeEventListener("click", handleConfirm);
            cancelBtn.removeEventListener("click", handleCancel);
            backdrop.removeEventListener("click", handleBackdrop);
            resolve(result);
          };
          const handleConfirm = () => cleanup(true);
          const handleCancel = () => cleanup(false);
          const handleBackdrop = (event) => {
            if (event.target === backdrop) {
              cleanup(false);
            }
          };
          confirmBtn.addEventListener("click", handleConfirm);
          cancelBtn.addEventListener("click", handleCancel);
          backdrop.addEventListener("click", handleBackdrop);
        });
      }

      function normalizeDownloadConfirmFailures(failures) {
        if (!Array.isArray(failures)) return [];
        return failures
          .map((failure) => {
            const error = String(failure?.error || "").trim();
            if (!error) return null;
            const label = String(
              failure?.url || failure?.title || "対象URL",
            ).trim() || "対象URL";
            const hints = Array.isArray(failure?.errorHints)
              ? failure.errorHints
              : Array.isArray(window.getLocalTubeErrorHints?.(error))
                ? window.getLocalTubeErrorHints(error)
                : [];
            return {
              label,
              error,
              hints: hints
                .map((hint) => String(hint || "").trim())
                .filter(Boolean),
            };
          })
          .filter(Boolean);
      }

      function simplifyDownloadConfirmErrorMessage(error) {
        const text = String(error || "").trim();
        const simplified = text.replace(
          /^ERROR:\s*\[[^\]]+\]\s*[^:]+:\s*/i,
          "",
        );
        return simplified || text;
      }

      function groupDownloadConfirmFailures(failures) {
        const groups = new Map();
        normalizeDownloadConfirmFailures(failures).forEach((item) => {
          const message = simplifyDownloadConfirmErrorMessage(item.error);
          const hints = item.hints;
          const key = JSON.stringify({ message, hints });
          if (!groups.has(key)) {
            groups.set(key, {
              message,
              hints,
              labels: [],
            });
          }
          const group = groups.get(key);
          if (!group.labels.includes(item.label)) {
            group.labels.push(item.label);
          }
        });
        return [...groups.values()];
      }

      function renderDownloadConfirmFailures(failures = []) {
        const {
          errors: errorsEl,
          errorsCopy,
          errorsList,
        } = downloadConfirmModalElements;
        if (!errorsEl || !errorsList) return;

        errorsList.innerHTML = "";
        const groups = groupDownloadConfirmFailures(failures);
        if (groups.length === 0) {
          errorsCopy && (errorsCopy.textContent = "");
          errorsEl.classList.add("hidden");
          return;
        }

        const totalCount = groups.reduce(
          (sum, group) => sum + group.labels.length,
          0,
        );
        if (errorsCopy) {
          errorsCopy.textContent =
            totalCount === 1
              ? "次のURLはサイズ見積もりの時点でエラーになりました。開始後は自動で除外されます。"
              : `${totalCount}件のURLはサイズ見積もりの時点でエラーになりました。開始後は自動で除外されます。`;
        }

        groups.forEach((group) => {
          const card = document.createElement("div");
          card.className = "download-confirm-modal-error-card";

          const icon = document.createElement("div");
          icon.className = "download-confirm-modal-error-icon";
          icon.textContent = "×";

          const body = document.createElement("div");
          body.className = "download-confirm-modal-error-body";

          const message = document.createElement("div");
          message.className = "download-confirm-modal-error-message";
          message.textContent = group.message;

          group.hints.forEach((hint) => {
            const hintEl = document.createElement("div");
            hintEl.className = "download-confirm-modal-error-hint";
            hintEl.textContent = hint;
            body.appendChild(hintEl);
          });

          body.appendChild(message);

          const urls = document.createElement("div");
          urls.className = "download-confirm-modal-error-urls";
          group.labels.forEach((label) => {
            const title = document.createElement("div");
            title.className = "download-confirm-modal-error-title";
            title.textContent = label;
            urls.appendChild(title);
          });
          body.appendChild(urls);

          card.appendChild(icon);
          card.appendChild(body);
          errorsList.appendChild(card);
        });

        errorsEl.classList.remove("hidden");
      }

      function collectFailedJobUrls() {
        const seen = new Set();
        const urls = [];
        for (const job of jobStates.values()) {
          if (job?.status !== "error") continue;
          const url = String(job?.url || "").trim();
          if (!url || seen.has(url)) continue;
          seen.add(url);
          urls.push(url);
        }
        return urls;
      }

      function formatFailedUrlExportFilename(now = new Date()) {
        const yyyy = String(now.getFullYear());
        const MM = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        const ss = String(now.getSeconds()).padStart(2, "0");
        return `localtube-errorlist-${yyyy}${MM}${dd}-${hh}${mm}${ss}.txt`;
      }

      function downloadTextFile(filename, text) {
        const blob = new Blob([String(text || "")], {
          type: "text/plain;charset=utf-8",
        });
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
      }

      function updateFailedUrlActionState() {
        const { openBtn } = failedUrlModalElements;
        if (!openBtn) return;
        const count = collectFailedJobUrls().length;
        openBtn.disabled = count === 0;
        openBtn.textContent = count > 0 ? `開く (${count}件)` : "開く";
      }

      function closeFailedUrlModal() {
        failedUrlModalElements.backdrop?.classList.add("hidden");
      }

      function openFailedUrlModal() {
        const {
          backdrop,
          copy,
          preview,
        } = failedUrlModalElements;
        if (!backdrop || !copy || !preview) return;
        const urls = collectFailedJobUrls();
        if (urls.length === 0) {
          uiFeedback.showInfo("失敗したURLはありません。");
          updateFailedUrlActionState();
          return;
        }
        copy.innerHTML = `<span class="failed-url-modal-count">${urls.length}件</span> の失敗URLをまとめています。`;
        preview.value = urls.join("\n");
        backdrop.classList.remove("hidden");
      }

      async function copyFailedUrlsToClipboard() {
        const urls = collectFailedJobUrls();
        if (urls.length === 0) {
          uiFeedback.showInfo("失敗したURLはありません。");
          updateFailedUrlActionState();
          return;
        }
        await navigator.clipboard.writeText(urls.join("\n"));
        uiFeedback.showSuccess(`${urls.length}件のURLをコピーしました。`);
      }

      function exportFailedUrlsToFile() {
        const urls = collectFailedJobUrls();
        if (urls.length === 0) {
          uiFeedback.showInfo("失敗したURLはありません。");
          updateFailedUrlActionState();
          return;
        }
        downloadTextFile(
          formatFailedUrlExportFilename(),
          `${urls.join("\n")}\n`,
        );
        uiFeedback.showSuccess(`${urls.length}件のURLをエクスポートしました。`);
      }

      function autofillFailedUrlsForDownload() {
        const urls = collectFailedJobUrls();
        if (urls.length === 0) {
          uiFeedback.showInfo("失敗したURLはありません。");
          updateFailedUrlActionState();
          return;
        }
        const urlsInput = document.getElementById("urls");
        if (!urlsInput) return;
        urlsInput.value = urls.join("\n");
        window.location.hash = "#downloader";
        urlsInput.focus?.();
        urlsInput.scrollIntoView?.({ block: "center", behavior: "smooth" });
        uiFeedback.showSuccess(`${urls.length}件のURLをダウンロード欄へ入力しました。`);
      }

      function showDownloadConfirmModal({ message, estimateText, failures } = {}) {
        const {
          backdrop,
          message: messageEl,
          estimate,
          skipCheckbox,
          cancelBtn,
          confirmBtn,
        } = downloadConfirmModalElements;
        if (!backdrop || !messageEl || !skipCheckbox || !cancelBtn || !confirmBtn) {
          return Promise.resolve({
            confirmed: window.confirm(String(message || "")),
            skipFuture: false,
          });
        }

        messageEl.textContent = String(message || "");
        const estimateValue = String(estimateText || "").trim();
        if (estimate) {
          estimate.textContent = estimateValue;
          estimate.classList.toggle("hidden", estimateValue === "");
        }
        renderDownloadConfirmFailures(failures);
        skipCheckbox.checked = false;
        backdrop.classList.remove("hidden");

        return new Promise((resolve) => {
          let settled = false;
          const cleanup = (confirmed) => {
            if (settled) return;
            settled = true;
            backdrop.classList.add("hidden");
            renderDownloadConfirmFailures([]);
            cancelBtn.removeEventListener("click", handleCancel);
            confirmBtn.removeEventListener("click", handleConfirm);
            backdrop.removeEventListener("click", handleBackdrop);
            resolve({
              confirmed,
              skipFuture: confirmed && skipCheckbox.checked,
            });
          };
          const handleCancel = () => cleanup(false);
          const handleConfirm = () => cleanup(true);
          const handleBackdrop = (event) => {
            if (event.target === backdrop) {
              cleanup(false);
            }
          };
          cancelBtn.addEventListener("click", handleCancel);
          confirmBtn.addEventListener("click", handleConfirm);
          backdrop.addEventListener("click", handleBackdrop);
        });
      }

      const downloadEstimateListToggle = document.getElementById("download-estimate-list-toggle");
      const downloadEstimateList = document.getElementById("download-estimate-list");
      downloadEstimateListToggle?.addEventListener("click", () => {
        if (!downloadEstimateList) return;
        const collapsed = downloadEstimateList.classList.toggle("collapsed");
        downloadEstimateListToggle.textContent = collapsed ? "展開" : "折りたたむ";
      });
      failedUrlModalElements.openBtn?.addEventListener("click", openFailedUrlModal);
      failedUrlModalElements.cancelBtn?.addEventListener("click", closeFailedUrlModal);
      failedUrlModalElements.backdrop?.addEventListener("click", (event) => {
        if (event.target === failedUrlModalElements.backdrop) {
          closeFailedUrlModal();
        }
      });
      failedUrlModalElements.copyBtn?.addEventListener("click", async () => {
        try {
          await copyFailedUrlsToClipboard();
          closeFailedUrlModal();
        } catch (error) {
          console.error("Failed URL copy failed:", error);
          uiFeedback.showError("失敗URLのコピーに失敗しました。");
        }
      });
      failedUrlModalElements.exportBtn?.addEventListener("click", () => {
        try {
          exportFailedUrlsToFile();
          closeFailedUrlModal();
        } catch (error) {
          console.error("Failed URL export failed:", error);
          uiFeedback.showError("失敗URLのエクスポートに失敗しました。");
        }
      });
      failedUrlModalElements.autofillBtn?.addEventListener("click", () => {
        try {
          autofillFailedUrlsForDownload();
          closeFailedUrlModal();
        } catch (error) {
          console.error("Failed URL autofill failed:", error);
          uiFeedback.showError("失敗URLの自動入力に失敗しました。");
        }
      });
      updateFailedUrlActionState();

      const dashboardController = window.createDashboardController({
        jobStates,
        renderJob,
        updateJobElement,
        documentRef: document,
        EventSourceImpl: window.EventSource,
        ChartImpl: window.Chart,
        nowProvider: () => new Date(),
      });
      const localVideoModule = window.createLocalVideoModule({
        appState,
        parseApiResponse,
        formatUploadDateForDescription,
        formatChannelSubscribers,
        normalizeLiveChatBaseName,
        parseNdjsonMessages,
        extractNonEmptyNdjsonLines:
          window.extractNonEmptyNdjsonLines ||
          ((text) =>
            String(text || "")
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line.length > 0)),
        getVideoIdFromFilename,
        createCommentRenderer,
        createChatLineElementFromMessage,
        onMetric: (name, value, meta) => window.recordPerfMetric?.(name, value, meta),
        onError: (message, error) => {
          console.error(message, error);
          const suffix = error?.message ? ` ${error.message}` : "";
          uiFeedback.showError(`${message}${suffix}`);
        },
        showConfirm: showSettingsConfirmModal,
        showSuccess: (message) => uiFeedback.showSuccess(message),
      });
      const { createVideoDataController, createLocalVideoController } =
        localVideoModule;

      // --- Main Logic ---
      async function registerServiceWorker() {
        if (
          typeof window === "undefined" ||
          typeof navigator === "undefined" ||
          !("serviceWorker" in navigator)
        ) {
          return;
        }
        try {
          await navigator.serviceWorker.register("/sw.js");
        } catch (error) {
          console.warn("Service Worker registration failed:", error);
        }
      }

      function initializeSettingsAndSse() {
        const elements = {
          fmt: document.getElementById("fmt"),
          videoFormat: document.getElementById("videoFormat"),
          savePath: document.getElementById("savePath"),
          optHistory: document.getElementById("optHistory"),
          optThumb: document.getElementById("optThumb"),
          optEmbedThumbnail: document.getElementById("optEmbedThumbnail"),
          optAddMetadata: document.getElementById("optAddMetadata"),
          optRemuxVideo: document.getElementById("optRemuxVideo"),
          optStaticFormat: document.getElementById("optStaticFormat"),
          optForceIpv4: document.getElementById("optForceIpv4"),
          optDrm: document.getElementById("optDrm"),
          optParallelDownloads: document.getElementById("optParallelDownloads"),
          parallelDownloadsValue: document.getElementById(
            "parallelDownloadsValue",
          ),
          optConcurrentFragments: document.getElementById(
            "optConcurrentFragments",
          ),
          concurrentFragmentsValue: document.getElementById(
            "concurrentFragmentsValue",
          ),
          urls: document.getElementById("urls"),
          jobQueue: document.getElementById("job-queue"),
          // New Cookie UI elements
          cookieStatusDisplay: document.getElementById("cookie-status-display"),
          setFirefoxBtn: document.getElementById("set-firefox-btn"),
          manualSelectBtn: document.getElementById("manual-select-btn"),
          noneSelectBtn: document.getElementById("none-select-btn"),
          cookiePathSet: document.getElementById("cookiePathSet"),
          optDownloadComments: document.getElementById("optDownloadComments"),
          optDownloadChat: document.getElementById("optDownloadChat"),
          optDownloadVideo: document.getElementById("optDownloadVideo"),
          ytDlpCustomCommandInput: document.getElementById(
            "yt-dlp-custom-command-input",
          ),
          saveYtDlpCustomCommandBtn: document.getElementById(
            "save-yt-dlp-custom-command-btn",
          ),
          ytDlpCustomCommandStatus: document.getElementById(
            "yt-dlp-custom-command-status",
          ),
          generateReportBtn: document.getElementById("generate-report-btn"),
          reportGenerateStatus: document.getElementById("report-generate-status"),
          reportModalBackdrop: document.getElementById("report-modal-backdrop"),
          reportModalCancelBtn: document.getElementById("report-modal-cancel-btn"),
          reportModalConfirmBtn: document.getElementById("report-modal-confirm-btn"),
          openFeedbackModalBtn: document.getElementById("open-feedback-modal-btn"),
          feedbackModalStatus: document.getElementById("feedback-modal-status"),
          feedbackModalBackdrop: document.getElementById("feedback-modal-backdrop"),
          feedbackModalCancelBtn: document.getElementById("feedback-modal-cancel-btn"),
          feedbackModalConfirmBtn: document.getElementById("feedback-modal-confirm-btn"),
          feedbackModalSubmitStatus: document.getElementById("feedback-modal-submit-status"),
          feedbackCategorySelect: document.getElementById("feedback-category-select"),
          feedbackMessageInput: document.getElementById("feedback-message-input"),
          feedbackConfirmModalBackdrop: document.getElementById("feedback-confirm-modal-backdrop"),
          feedbackConfirmModalCancelBtn: document.getElementById("feedback-confirm-modal-cancel-btn"),
          feedbackConfirmModalConfirmBtn: document.getElementById("feedback-confirm-modal-confirm-btn"),
          settingsConfirmModalBackdrop: document.getElementById("settings-confirm-modal-backdrop"),
          settingsConfirmModalMessage: document.getElementById("settings-confirm-modal-message"),
          settingsConfirmModalCancelBtn: document.getElementById("settings-confirm-modal-cancel-btn"),
          settingsConfirmModalConfirmBtn: document.getElementById("settings-confirm-modal-confirm-btn"),
          clearHistoryBtn: document.getElementById("clearHistoryBtn"),
          localVideoDirsInput: document.getElementById("local-video-dirs-input"),
          saveLocalVideoDirsBtn: document.getElementById(
            "save-local-video-dirs-btn",
          ),
          localVideoDirsStatus: document.getElementById("local-video-dirs-status"),
          optFallbackThumbnails: document.getElementById(
            "opt-fallback-thumbnails",
          ),
          fallbackThumbStatus: document.getElementById("fallback-thumb-status"),
          optDownloadEstimates: document.getElementById("opt-download-estimates"),
          downloadEstimateStatus: document.getElementById("download-estimate-setting-status"),
          wallpaperStatus: document.getElementById("wallpaper-status"),
          wallpaperFileInput: document.getElementById("wallpaper-file-input"),
          wallpaperSelectBtn: document.getElementById("wallpaper-select-btn"),
          wallpaperClearBtn: document.getElementById("wallpaper-clear-btn"),
          wallpaperBlurRange: document.getElementById("wallpaper-blur-range"),
          wallpaperBlurValue: document.getElementById("wallpaper-blur-value"),
          wallpaperBrightnessRange: document.getElementById(
            "wallpaper-brightness-range",
          ),
          wallpaperBrightnessValue: document.getElementById(
            "wallpaper-brightness-value",
          ),
        };
        initializeSettingsUiController({
          elements,
          onLocalVideosChanged: async (videos) => {
            await window.refreshLocalVideos?.(videos);
          },
          dependencies: {
            parseApiResponseImpl: parseApiResponse,
            fetchImpl: (...args) => fetch(...args),
            notifyInfoImpl: (message) => uiFeedback.showInfo(message),
            notifyErrorImpl: (message) => uiFeedback.showError(message),
            writeClipboardTextImpl: (text) => navigator.clipboard.writeText(text),
          },
        });

        dashboardController.createSseController({
          jobQueueElement: elements.jobQueue,
          onJobUpdated: () => {
            updateFailedUrlActionState();
          },
        });
        updateFailedUrlActionState();
      }

      function initializeFormatToggle() {
        const fmtSelect = document.getElementById("fmt");
        const videoFormatSelect = document.getElementById("videoFormat");
        const staticToggle = document.getElementById("optStaticFormat");
        if (!fmtSelect || !staticToggle || !fmtSelect.options) return;

        const dynamicOptions = Array.from(fmtSelect.options).map((option) => ({
          value: option.value,
          text: option.textContent,
        }));

        const staticOptions = [
          { value: "400-0+140/400+140/399-0+140/399+140/298-0+140/298+140/135-0+140/135+140/134-0+140/134+140/133-0+140/133+140/160-0+140/160+140", text: "1440p（1440 x 2560）" },
          { value: "399-0+140/399+140/298-0+140/298+140/135-0+140/135+140/134-0+140/134+140/133-0+140/133+140/160-0+140/160+140", text: "1080p（1920 x 1080）" },
          { value: "298-0+140/298+140/135-0+140/135+140/134-0+140/134+140/133-0+140/133+140/160-0+140/160+140", text: "720p （1280 x 720 ）" },
          { value: "135-0+140/135+140/134-0+140/134+140/133-0+140/133+140/160-0+140/160+140", text: "480p （720 x 480 ）" },
          { value: "134-0+140/134+140/133-0+140/133+140/160-0+140/160+140", text: "360p （640 x 360 ）" },
          { value: "133-0+140/133+140/160-0+140/160+140", text: "240p （ 426 x 240 ）" },
          { value: "160-0+140/160+140", text: "144p （256 x 144 ）" },
        ];

        const applyVideoCodecPreference = (value, codec) => {
          const text = String(value || "");
          if (codec === "av01") {
            return text.replace(/\[ext=mp4\]/g, "[vcodec=av01]");
          }
          if (codec === "vp9") {
            return text.replace(/\[ext=mp4\]/g, "[vcodec=vp9]");
          }
          return text;
        };

        const buildDynamicOptionsForCodec = (codec) =>
          dynamicOptions.map((option) => ({
            value: applyVideoCodecPreference(option.value, codec),
            text: option.text,
          }));

        const readSavedFormatValue = () =>
          typeof window.loadLocalSetting === "function"
            ? window.loadLocalSetting("fmt", fmtSelect.value)
            : fmtSelect.value;

        const applyOptions = (options, preferredValue = fmtSelect.value) => {
          fmtSelect.innerHTML = "";
          options.forEach((option) => {
            const opt = document.createElement("option");
            opt.value = option.value;
            opt.textContent = option.text;
            fmtSelect.appendChild(opt);
          });
          if (options.some((opt) => opt.value === preferredValue)) {
            fmtSelect.value = preferredValue;
          } else {
            fmtSelect.selectedIndex = 0;
          }
        };

        const sync = ({ useSavedValue = false } = {}) => {
          const preferredValue = useSavedValue ? readSavedFormatValue() : fmtSelect.value;
          const codec = videoFormatSelect?.value || "auto";
          const options = staticToggle.checked
            ? staticOptions
            : buildDynamicOptionsForCodec(codec);
          applyOptions(options, preferredValue);
        };

        staticToggle.addEventListener("change", sync);
        videoFormatSelect?.addEventListener("change", sync);
        sync({ useSavedValue: true });
      }

      function initializeAdvancedDownloadSettingsToggle() {
        const storageKey = "advancedDownloadSettingsCollapsed";
        const section = document.getElementById("advanced-download-settings-section");
        if (!section) return;
        if (typeof section.querySelector !== "function") return;
        const toggleBtn = section.querySelector(".sidebar-toggle");
        const icon = toggleBtn?.querySelector("i");
        const content = section.querySelector(".sidebar-content");
        if (!toggleBtn || !icon || !content) return;

        const applyCollapsedState = (collapsed) => {
          content.classList.toggle("collapsed", collapsed);
          section.classList.toggle("collapsed", collapsed);
          icon.className = collapsed
            ? "fa-solid fa-chevron-right"
            : "fa-solid fa-chevron-down";
        };

        const initialCollapsed =
          typeof window.loadLocalSetting === "function"
            ? window.loadLocalSetting(storageKey, true)
            : true;
        applyCollapsedState(Boolean(initialCollapsed));

        toggleBtn.addEventListener("click", () => {
          const nextCollapsed = !section.classList.contains("collapsed");
          applyCollapsedState(nextCollapsed);
          if (typeof window.saveLocalSetting === "function") {
            window.saveLocalSetting(storageKey, nextCollapsed);
          }
        });
      }

      // --- Actions ---
      const downloadActions = window.createDownloadActions({
        parseApiResponse,
        notifyInfo: (message) => uiFeedback.showSuccess(message),
        notifyError: (message) => uiFeedback.showError(message),
        showDownloadConfirm: (payload) => showDownloadConfirmModal(payload),
        onError: (error) => {
          console.error("Fetch error:", error);
        },
      });
      window.start = () => downloadActions.startDownload();

      const headerRoutingController = window.createHeaderRoutingController({
        appState,
      });
      const playerPageController = window.createPlayerPageController({
        createHomeVideoBrowserController,
        createVideoDataController,
        createPlayerUiController,
        createLocalVideoController,
        linkifyText,
      });
      const playlistPageController = typeof window.createPlaylistPageController === "function"
        ? window.createPlaylistPageController({
          parseApiResponse,
          appState,
        })
        : { initialize: () => {} };

      document.addEventListener("DOMContentLoaded", () => {
        registerServiceWorker();
        initializeSettingsAndSse();
        initializeFormatToggle();
        initializeAdvancedDownloadSettingsToggle();
        headerRoutingController.initialize();
        playerPageController.initialize();
        playlistPageController.initialize();
      });

      document.addEventListener("job_completed", () => {
        window.refreshLocalVideos?.();
      });
