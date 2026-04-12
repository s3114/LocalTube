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
        });
      }

      function initializeFormatToggle() {
        const fmtSelect = document.getElementById("fmt");
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

        const applyOptions = (options) => {
          const previousValue = fmtSelect.value;
          fmtSelect.innerHTML = "";
          options.forEach((option) => {
            const opt = document.createElement("option");
            opt.value = option.value;
            opt.textContent = option.text;
            fmtSelect.appendChild(opt);
          });
          if (options.some((opt) => opt.value === previousValue)) {
            fmtSelect.value = previousValue;
          } else {
            fmtSelect.selectedIndex = 0;
          }
        };

        const sync = () => {
          applyOptions(staticToggle.checked ? staticOptions : dynamicOptions);
        };

        staticToggle.addEventListener("change", sync);
        sync();
      }

      // --- Actions ---
      const downloadActions = window.createDownloadActions({
        parseApiResponse,
        notifyInfo: (message) => uiFeedback.showSuccess(message),
        notifyError: (message) => uiFeedback.showError(message),
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
        headerRoutingController.initialize();
        playerPageController.initialize();
        playlistPageController.initialize();
      });

      document.addEventListener("job_completed", () => {
        window.refreshLocalVideos?.();
      });
