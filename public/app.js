const appState = window.AppState || {
  pendingVideoId: null,
  jobStates: new Map(),
};

      // --- Global State ---
      const jobStates = appState.jobStates;

      // --- Helper Functions ---
      const appCore = window.createAppCore({ jobStates });
      const { renderJob, updateJobElement, parseApiResponse, linkifyText } = appCore;

      const dashboardController = window.createDashboardController({
        jobStates,
        renderJob,
        updateJobElement,
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
      });
      const { createVideoDataController, createLocalVideoController } =
        localVideoModule;

      // --- Main Logic ---
      function initializeSettingsAndSse() {
        const elements = {
          fmt: document.getElementById("fmt"),
          savePath: document.getElementById("savePath"),
          optHistory: document.getElementById("optHistory"),
          optThumb: document.getElementById("optThumb"),
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
        });

        dashboardController.createSseController({
          jobQueueElement: elements.jobQueue,
        });
      }

      // --- Actions ---
      const downloadActions = window.createDownloadActions({
        parseApiResponse,
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
        initializeSettingsAndSse();
        headerRoutingController.initialize();
        playerPageController.initialize();
      });

      document.addEventListener("job_completed", () => {
        window.refreshLocalVideos?.();
      });
