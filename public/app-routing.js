(function attachHeaderRoutingController(global) {
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
        pages.forEach((p) => p.classList.remove("active-page"));

        const target = document.getElementById(pageId);
        if (target) {
          target.classList.add("active-page");
        }
        global.updateHeaderSearchVisibility(pageId);
        global.updateSmoothSeekLoopState?.();
      }

      function setActiveButton(pageId) {
        buttons.forEach((b) => {
          if (b.dataset.page === pageId) {
            b.classList.add("active");
          } else {
            b.classList.remove("active");
          }
        });
      }

      function routeFromHash() {
        const hash = location.hash.replace("#", "");
        const [page, videoId] = hash.split("/");

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
})(window);

