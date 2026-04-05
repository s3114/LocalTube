(function attachPlayerPageController(global) {
  function getPlayerPageElements() {
    return {
      desc: document.getElementById("video-description"),
      videoPlayer: document.getElementById("local-player"),
      videoList: document.getElementById("local-video-list"),
      homeVideoGrid: document.querySelector(".home-video-grid"),
      homeSearchInput: document.getElementById("home-search-input"),
      homeFilterBtn: document.getElementById("home-filter-btn"),
      homeFilterPanel: document.getElementById("home-filter-panel"),
      homeSortBtn: document.getElementById("home-sort-btn"),
      homeSortPanel: document.getElementById("home-sort-panel"),
      homeSortKeyButtons: document.querySelectorAll(".home-sort-key-btn"),
      homeSortOrderButtons: document.querySelectorAll(".home-sort-order-btn"),
      filterDateFrom: document.getElementById("filter-date-from"),
      filterDateFromText: document.getElementById("filter-date-from-text"),
      filterDateTo: document.getElementById("filter-date-to"),
      filterDateToText: document.getElementById("filter-date-to-text"),
      filterDurationRange: document.getElementById("filter-duration-range"),
      filterDurationMin: document.getElementById("filter-duration-min"),
      filterDurationMax: document.getElementById("filter-duration-max"),
      filterChannel: document.getElementById("filter-channel"),
      filterFilepath: document.getElementById("filter-filepath"),
      filterClearBtn: document.getElementById("filter-clear-btn"),
      titleEl: document.getElementById("player-title"),
      seekBar: document.getElementById("seek-bar"),
      btnPlay: document.getElementById("btn-play"),
      btnPip: document.getElementById("btn-pip"),
      btnFull: document.getElementById("btn-full"),
      timeDisplay: document.getElementById("time-display"),
      playerMain: document.querySelector(".player-main"),
      chatSection: document.getElementById("chat-section"),
      chatContent: document.getElementById("live-chat-container"),
    };
  }

  function createDescriptionController(desc) {
    function getDescContentElement() {
      return desc?.querySelector(".yt-description-content") || null;
    }

    function getCollapseButton() {
      return desc?.querySelector(".yt-desc-collapse-btn") || null;
    }

    function updateDescButton() {
      if (!desc) return;
      const contentEl = getDescContentElement();
      const collapseBtn = getCollapseButton();
      if (!contentEl || !collapseBtn) return;

      const isCollapsed = contentEl.classList.contains("collapsed");
      const canExpand = isCollapsed
        ? contentEl.scrollHeight > contentEl.clientHeight + 2
        : contentEl.scrollHeight > 0;

      if (!canExpand) {
        desc.classList.remove("expandable");
        collapseBtn.style.display = "none";
        contentEl.classList.remove("collapsed");
        return;
      }

      desc.classList.add("expandable");
      collapseBtn.style.display = isCollapsed ? "none" : "inline";
    }

    function initializeDescriptionController() {
      if (!desc) return;
      updateDescButton();
      global.addEventListener("resize", updateDescButton);

      desc.addEventListener("click", (event) => {
        if (event.target.closest("a")) return;
        if (event.target.closest(".yt-desc-collapse-btn")) return;

        const contentEl = getDescContentElement();
        const collapseBtn = getCollapseButton();
        if (!contentEl || !collapseBtn) return;
        if (!contentEl.classList.contains("collapsed")) return;

        contentEl.classList.remove("collapsed");
        collapseBtn.style.display = "inline";
      });

      desc.addEventListener("click", (event) => {
        const collapseBtn = event.target.closest(".yt-desc-collapse-btn");
        if (!collapseBtn) return;
        event.preventDefault();
        event.stopPropagation();
        const contentEl = getDescContentElement();
        if (!contentEl) return;
        contentEl.classList.add("collapsed");
        collapseBtn.style.display = "none";
        updateDescButton();
      });
    }

    return {
      updateDescButton,
      initialize: initializeDescriptionController,
    };
  }

  function createChatHeightController(playerMain, chatSection, chatContent) {
    function sync() {
      if (!playerMain || !chatSection || !chatContent) return;

      if (chatSection.classList.contains("collapsed")) {
        chatContent.style.height = "0px";
        chatContent.style.overflow = "hidden";
        return;
      }

      chatContent.style.height = "";
      chatContent.style.overflow = "auto";
    }

    function initializeChatHeightController() {
      setTimeout(sync, 100);
      global.addEventListener("resize", sync);
    }

    return {
      sync,
      initialize: initializeChatHeightController,
    };
  }

  function createPlayerFullscreenToggleHandler(videoPlayer) {
    let restorePageFullscreenOnExit = false;
    const getFullscreenElement = () =>
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement ||
      null;

    const requestFullscreen = async (el) => {
      if (!el) return false;
      if (typeof el.requestFullscreen === "function") {
        await el.requestFullscreen();
        return true;
      }
      if (typeof el.webkitRequestFullscreen === "function") {
        el.webkitRequestFullscreen();
        return true;
      }
      if (typeof el.msRequestFullscreen === "function") {
        el.msRequestFullscreen();
        return true;
      }
      return false;
    };

    const exitFullscreen = async () => {
      if (typeof document.exitFullscreen === "function") {
        await document.exitFullscreen();
        return true;
      }
      if (typeof document.webkitExitFullscreen === "function") {
        document.webkitExitFullscreen();
        return true;
      }
      if (typeof document.msExitFullscreen === "function") {
        document.msExitFullscreen();
        return true;
      }
      return false;
    };

    return async function toggleFullscreen() {
      const playerContainer = document.getElementById("player-container");
      const playerTarget = videoPlayer || playerContainer;
      const activeFullscreen = getFullscreenElement();
      const pageRoot = document.documentElement;

      if (activeFullscreen) {
        // プレーヤー自身が全画面中なら解除
        if (activeFullscreen === videoPlayer || activeFullscreen === playerContainer) {
          await exitFullscreen();
          if (restorePageFullscreenOnExit) {
            restorePageFullscreenOnExit = false;
            try {
              await requestFullscreen(pageRoot);
            } catch (_e) {
              // no-op
            }
          }
          return;
        }
        // ページ全画面など他要素が全画面中なら、解除して即プレーヤー全画面へ切替
        restorePageFullscreenOnExit = activeFullscreen === pageRoot;
        try {
          await requestFullscreen(playerTarget);
        } catch (_e) {
          await requestFullscreen(playerContainer);
        }
        return;
      }
      restorePageFullscreenOnExit = false;
      try {
        await requestFullscreen(videoPlayer);
      } catch (_e) {
        await requestFullscreen(playerContainer);
      }
    };
  }

  function collapseSectionById(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    const content = section.querySelector(".sidebar-content");
    if (!content) return;
    content.classList.add("collapsed");
    section.classList.add("collapsed");
    const icon = section.querySelector(".sidebar-toggle i");
    if (icon) {
      icon.className = "fa-solid fa-chevron-right";
    }
  }

  function applyInitialMobileCollapsedState() {
    if (!global.matchMedia || !global.matchMedia("(max-width: 768px)").matches) return;
    collapseSectionById("comment-section");
    collapseSectionById("chat-section");
  }

  function createPlayerPageController({
    createHomeVideoBrowserController,
    createVideoDataController,
    createPlayerUiController,
    createLocalVideoController,
    linkifyText,
  }) {
    function initialize() {
      const elements = getPlayerPageElements();
      const descriptionController = createDescriptionController(elements.desc);
      const chatHeightController = createChatHeightController(
        elements.playerMain,
        elements.chatSection,
        elements.chatContent,
      );

      let localVideoController = null;
      const homeVideoBrowser = createHomeVideoBrowserController({
        homeVideoGrid: elements.homeVideoGrid,
        homeSearchInput: elements.homeSearchInput,
        homeFilterBtn: elements.homeFilterBtn,
        homeFilterPanel: elements.homeFilterPanel,
        homeSortBtn: elements.homeSortBtn,
        homeSortPanel: elements.homeSortPanel,
        homeSortKeyButtons: elements.homeSortKeyButtons,
        homeSortOrderButtons: elements.homeSortOrderButtons,
        filterDateFrom: elements.filterDateFrom,
        filterDateFromText: elements.filterDateFromText,
        filterDateTo: elements.filterDateTo,
        filterDateToText: elements.filterDateToText,
        filterDurationRange: elements.filterDurationRange,
        filterDurationMin: elements.filterDurationMin,
        filterDurationMax: elements.filterDurationMax,
        filterChannel: elements.filterChannel,
        filterFilepath: elements.filterFilepath,
        filterClearBtn: elements.filterClearBtn,
        onMetric: (name, value, meta) =>
          global.recordPerfMetric?.(name, value, meta),
        onSelectVideo: (selectedVideo) => {
          localVideoController?.playLocalVideo(selectedVideo);
        },
        onOpenVideoOptions: (video, anchorElement) => {
          localVideoController?.openVideoOptionsForVideo?.(video, anchorElement);
        },
      });
      homeVideoBrowser.initialize();

      const videoDataController = createVideoDataController({
        linkify: linkifyText,
        updateDescButton: descriptionController.updateDescButton,
      });

      const playerUi = createPlayerUiController({
        videoPlayer: elements.videoPlayer,
        seekBar: elements.seekBar,
        btnPlay: elements.btnPlay,
        btnPip: elements.btnPip,
        btnFull: elements.btnFull,
        timeDisplay: elements.timeDisplay,
        onToggleFullscreen: createPlayerFullscreenToggleHandler(elements.videoPlayer),
        onSidebarToggled: chatHeightController.sync,
        renderSortedComments: (sorted) => {
          videoDataController.renderSortedComments(sorted);
        },
        syncChatReplayForCurrentTime: (currentSec, options) =>
          videoDataController.syncChatReplayForCurrentTime(currentSec, options),
      });

      localVideoController = createLocalVideoController({
        videoPlayer: elements.videoPlayer,
        videoList: elements.videoList,
        homeVideoGrid: elements.homeVideoGrid,
        titleEl: elements.titleEl,
        onResetSeekBar: () => playerUi.resetSeekBar(),
        onLoadSideData: (videoId) => {
          videoDataController.loadCurrentVideoSideData(videoId);
        },
        onRenderHomeVideos: (videos) => {
          homeVideoBrowser.setVideos(videos);
          if (document.getElementById("page-home")?.classList.contains("active-page")) {
            homeVideoBrowser.render();
          }
        },
        onPrefetchHomeInfos: () => homeVideoBrowser.prefetch(),
      });

      function initializeDataLoadingAndPlaybackState() {
        playerUi.updateSmoothSeekLoopState();
        localVideoController.loadLocalVideos();
      }

      function tryResolvePendingPlayerVideo() {
        localVideoController?.playPendingVideoIfAny?.(false);
      }

      descriptionController.initialize();
      chatHeightController.initialize();
      playerUi.initialize();
      applyInitialMobileCollapsedState();
      initializeDataLoadingAndPlaybackState();
      global.playLocalVideoById = (videoId, options) =>
        localVideoController?.playVideoById?.(videoId, options) || false;
      global.addEventListener("app:page-changed", (event) => {
        if (event?.detail?.pageId === "page-player") {
          tryResolvePendingPlayerVideo();
        }
      });
      global.addEventListener("hashchange", () => {
        const hash = String(global.location?.hash || "");
        if (hash.startsWith("#player/")) {
          tryResolvePendingPlayerVideo();
        }
      });
      global.refreshLocalVideos = (videos) => {
        if (Array.isArray(videos)) {
          localVideoController.applyLocalVideos(videos);
          return Promise.resolve();
        }
        return localVideoController.loadLocalVideos(true);
      };
    }

    return {
      initialize,
    };
  }

  global.createPlayerPageController = createPlayerPageController;
})(window);
