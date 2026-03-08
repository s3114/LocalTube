(function attachHeaderRoutingController(global) {
  function resolvePageIdFromHash(hash) {
    const normalizedHash = String(hash || "").replace("#", "");
    const [page, videoId] = normalizedHash.split("/");

    let pageId;
    switch (page) {
      case "home":
        pageId = "page-home";
        break;
      case "player":
        pageId = "page-player";
        break;
      case "playlists":
        pageId = "page-playlists";
        break;
      case "settings":
        pageId = "page-settings";
        break;
      case "downloader":
      case "":
        pageId = "page-downloader";
        break;
      default:
        pageId = "page-downloader";
    }

    return { page, videoId, pageId };
  }

  function applyPageVisibility(pages, pageId) {
    pages.forEach((page) => page.classList.remove("active-page"));
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
      targetPage.classList.add("active-page");
    }
  }

  function applyActiveButton(buttons, pageId) {
    buttons.forEach((button) => {
      if (button.dataset.page === pageId) {
        button.classList.add("active");
      } else {
        button.classList.remove("active");
      }
    });
  }

  function notifyPageChanged(globalObj, pageId) {
    if (typeof globalObj.dispatchEvent !== "function") return;

    if (typeof globalObj.CustomEvent === "function") {
      globalObj.dispatchEvent(
        new globalObj.CustomEvent("app:page-changed", {
          detail: { pageId },
        }),
      );
      return;
    }

    if (typeof globalObj.Event === "function") {
      const event = new globalObj.Event("app:page-changed");
      event.detail = { pageId };
      globalObj.dispatchEvent(event);
    }
  }

  function createHeaderRoutingController({ appState }) {
    function getFullscreenElement() {
      return (
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.msFullscreenElement ||
        null
      );
    }

    async function requestDocumentFullscreen() {
      const root = document.documentElement;
      if (!root) return false;

      if (typeof root.requestFullscreen === "function") {
        await root.requestFullscreen();
        return true;
      }
      if (typeof root.webkitRequestFullscreen === "function") {
        root.webkitRequestFullscreen();
        return true;
      }
      if (typeof root.msRequestFullscreen === "function") {
        root.msRequestFullscreen();
        return true;
      }
      return false;
    }

    async function exitDocumentFullscreen() {
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
    }

    function initializeMobileFullscreenButton() {
      const fullscreenButton = document.getElementById("btn-mobile-fullscreen");
      if (!fullscreenButton) return;

      const updateFullscreenButtonState = () => {
        const isFullscreen = !!getFullscreenElement();
        fullscreenButton.classList.toggle("active", isFullscreen);
        fullscreenButton.setAttribute("aria-pressed", isFullscreen ? "true" : "false");
        fullscreenButton.title = isFullscreen ? "全画面解除" : "全画面表示";
        fullscreenButton.innerHTML = isFullscreen
          ? '<i class="fa-solid fa-compress"></i>'
          : '<i class="fa-solid fa-expand"></i>';
      };

      fullscreenButton.addEventListener("click", async () => {
        try {
          if (getFullscreenElement()) {
            await exitDocumentFullscreen();
          } else {
            await requestDocumentFullscreen();
          }
        } catch (error) {
          console.warn("Fullscreen toggle failed:", error);
        } finally {
          updateFullscreenButtonState();
        }
      });

      document.addEventListener("fullscreenchange", updateFullscreenButtonState);
      document.addEventListener("webkitfullscreenchange", updateFullscreenButtonState);
      document.addEventListener("msfullscreenchange", updateFullscreenButtonState);
      updateFullscreenButtonState();
    }

    function initializeMobileBottomUiAutoHide() {
      const root = document.body;
      if (!root) return;
      const mobileQuery = global.matchMedia?.("(max-width: 768px)");
      if (!mobileQuery) return;
      const HIDE_DELAY_MS = 2200;

      const setHidden = (hidden) => {
        root.classList.toggle("mobile-bottom-ui-hidden", !!hidden);
      };

      let hideTimer = null;

      const clearHideTimer = () => {
        if (hideTimer) {
          global.clearTimeout(hideTimer);
          hideTimer = null;
        }
      };

      const scheduleHide = () => {
        clearHideTimer();
        if (!mobileQuery.matches) return;
        if ((global.scrollY || 0) < 24) return;
        hideTimer = global.setTimeout(() => {
          setHidden(true);
        }, HIDE_DELAY_MS);
      };

      let lastY = global.scrollY || 0;
      let ticking = false;

      const onScroll = () => {
        if (!mobileQuery.matches) {
          setHidden(false);
          lastY = global.scrollY || 0;
          clearHideTimer();
          ticking = false;
          return;
        }

        const currentY = global.scrollY || 0;
        const delta = currentY - lastY;
        lastY = currentY;

        if (Math.abs(delta) < 6) {
          scheduleHide();
          ticking = false;
          return;
        }

        if (currentY < 24) {
          setHidden(false);
          clearHideTimer();
          ticking = false;
          return;
        }

        if (delta > 0) {
          setHidden(true);
          scheduleHide();
        } else {
          setHidden(false);
          scheduleHide();
        }
        ticking = false;
      };

      const queueScrollHandler = () => {
        if (ticking) return;
        ticking = true;
        global.requestAnimationFrame(onScroll);
      };

      const onMediaChanged = () => {
        if (!mobileQuery.matches) {
          setHidden(false);
          clearHideTimer();
          return;
        }
        scheduleHide();
      };

      global.addEventListener("scroll", queueScrollHandler, { passive: true });
      global.addEventListener(
        "touchstart",
        () => {
          if (!mobileQuery.matches) return;
          setHidden(false);
          scheduleHide();
        },
        { passive: true },
      );
      if (typeof mobileQuery.addEventListener === "function") {
        mobileQuery.addEventListener("change", onMediaChanged);
      } else if (typeof mobileQuery.addListener === "function") {
        mobileQuery.addListener(onMediaChanged);
      }
      setHidden(false);
      scheduleHide();
    }

    function initialize() {
      const buttons = document.querySelectorAll(".icon-btn");
      const pages = document.querySelectorAll(".page");
      const headerSearchWrap = document.querySelector(".header-search-wrap");

      global.updateHeaderSearchVisibility = (pageId) => {
        if (!headerSearchWrap) return;
        headerSearchWrap.style.display = pageId === "page-home" ? "flex" : "none";
      };

      function showPage(pageId) {
        applyPageVisibility(pages, pageId);
        global.updateHeaderSearchVisibility(pageId);
        global.updateSmoothSeekLoopState?.();
        notifyPageChanged(global, pageId);
      }

      function setActiveButton(pageId) {
        applyActiveButton(buttons, pageId);
      }

      function routeFromHash() {
        const { page, videoId, pageId } = resolvePageIdFromHash(location.hash);

        showPage(pageId);
        setActiveButton(pageId);

        if (page === "player" && videoId) {
          appState.pendingVideoId = decodeURIComponent(videoId);
        }
      }

      buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
          const pageId = btn.dataset.page;
          const hash = pageId.replace("page-", "");
          history.pushState(null, "", "#" + hash);

          showPage(pageId);
          setActiveButton(pageId);
        });
      });

      global.addEventListener("popstate", routeFromHash);
      routeFromHash();
      initializeMobileFullscreenButton();
      initializeMobileBottomUiAutoHide();
    }

    return {
      initialize,
    };
  }

  global.createHeaderRoutingController = createHeaderRoutingController;
  global.__appRoutingTestUtils = {
    resolvePageIdFromHash,
  };
})(window);
