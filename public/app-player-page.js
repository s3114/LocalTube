(function attachPlayerPageController(global) {
  function getPlayerPageElements() {
    return {
      desc: document.getElementById("video-description"),
      toggleBtn: document.getElementById("desc-toggle"),
      videoPlayer: document.getElementById("local-player"),
      videoList: document.getElementById("local-video-list"),
      homeVideoGrid: document.querySelector(".home-video-grid"),
      homeSearchInput: document.getElementById("home-search-input"),
      homeFilterBtn: document.getElementById("home-filter-btn"),
      homeFilterPanel: document.getElementById("home-filter-panel"),
      filterDateFrom: document.getElementById("filter-date-from"),
      filterDateFromText: document.getElementById("filter-date-from-text"),
      filterDateTo: document.getElementById("filter-date-to"),
      filterDateToText: document.getElementById("filter-date-to-text"),
      filterDurationRange: document.getElementById("filter-duration-range"),
      filterDurationMin: document.getElementById("filter-duration-min"),
      filterDurationMax: document.getElementById("filter-duration-max"),
      filterChannel: document.getElementById("filter-channel"),
      filterClearBtn: document.getElementById("filter-clear-btn"),
      titleEl: document.getElementById("player-title"),
      seekBar: document.getElementById("seek-bar"),
      btnPlay: document.getElementById("btn-play"),
      btnFull: document.getElementById("btn-full"),
      timeDisplay: document.getElementById("time-display"),
      playerMain: document.querySelector(".player-main"),
      chatSection: document.getElementById("chat-section"),
      chatContent: document.getElementById("live-chat-container"),
    };
  }

  function createDescriptionController(desc, toggleBtn) {
    function updateDescButton() {
      if (!desc || !toggleBtn) return;
      if (desc.scrollHeight <= desc.clientHeight) {
        toggleBtn.style.display = "none";
      } else {
        toggleBtn.style.display = "inline";
      }
    }

    function initializeDescriptionController() {
      if (!desc || !toggleBtn) return;
      updateDescButton();
      global.addEventListener("resize", updateDescButton);
      toggleBtn.addEventListener("click", () => {
        desc.classList.toggle("collapsed");
        toggleBtn.textContent = desc.classList.contains("collapsed")
          ? "もっと見る"
          : "折りたたむ";
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
    return async function toggleFullscreen() {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      try {
        await videoPlayer.requestFullscreen();
      } catch (_e) {
        await document.getElementById("player-container")?.requestFullscreen();
      }
    };
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
      const descriptionController = createDescriptionController(
        elements.desc,
        elements.toggleBtn,
      );
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
        filterDateFrom: elements.filterDateFrom,
        filterDateFromText: elements.filterDateFromText,
        filterDateTo: elements.filterDateTo,
        filterDateToText: elements.filterDateToText,
        filterDurationRange: elements.filterDurationRange,
        filterDurationMin: elements.filterDurationMin,
        filterDurationMax: elements.filterDurationMax,
        filterChannel: elements.filterChannel,
        filterClearBtn: elements.filterClearBtn,
        onSelectVideo: (selectedVideo) => {
          localVideoController?.playLocalVideo(selectedVideo);
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
        btnFull: elements.btnFull,
        timeDisplay: elements.timeDisplay,
        onToggleFullscreen: createPlayerFullscreenToggleHandler(elements.videoPlayer),
        onSidebarToggled: chatHeightController.sync,
        renderSortedComments: (sorted) => {
          videoDataController.renderSortedComments(sorted);
        },
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
          homeVideoBrowser.render();
        },
        onPrefetchHomeInfos: () => homeVideoBrowser.prefetch(),
      });

      function initializeDataLoadingAndPlaybackState() {
        playerUi.updateSmoothSeekLoopState();
        localVideoController.loadLocalVideos();
      }

      descriptionController.initialize();
      chatHeightController.initialize();
      playerUi.initialize();
      initializeDataLoadingAndPlaybackState();
      global.refreshLocalVideos = () => localVideoController.loadLocalVideos();
    }

    return {
      initialize,
    };
  }

  global.createPlayerPageController = createPlayerPageController;
})(window);

