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
        getVideoIdFromFilename,
        createCommentRenderer,
        createChatLineElementFromMessage,
        onMetric: (name, value, meta) => window.recordPerfMetric?.(name, value, meta),
        onError: (message, error) => {
          console.error(message, error);
          const suffix = error?.message ? ` ${error.message}` : "";
          uiFeedback.showError(`${message}${suffix}`);
        },
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
          commentOptions: document.getElementById("comment-options"),
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
          onLocalVideosChanged: async () => {
            await window.refreshLocalVideos?.();
          },
          dependencies: {
            parseApiResponseImpl: parseApiResponse,
            fetchImpl: (...args) => fetch(...args),
            notifyInfoImpl: (message) => uiFeedback.showInfo(message),
            notifyErrorImpl: (message) => uiFeedback.showError(message),
            confirmImpl: (message) => confirm(message),
            writeClipboardTextImpl: (text) => navigator.clipboard.writeText(text),
          },
        });

        dashboardController.createSseController({
          jobQueueElement: elements.jobQueue,
        });
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

      document.addEventListener("DOMContentLoaded", () => {
        registerServiceWorker();
        initializeSettingsAndSse();
        headerRoutingController.initialize();
        playerPageController.initialize();
      });

      document.addEventListener("job_completed", () => {
        window.refreshLocalVideos?.();
      });
