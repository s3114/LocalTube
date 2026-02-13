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
