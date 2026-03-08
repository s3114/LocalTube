(function attachPlaylistPageModule(global) {
  function normalizePlaylistsState(rawState) {
    const source = rawState && typeof rawState === "object" ? rawState : {};
    const playlists = Array.isArray(source.playlists)
      ? source.playlists
        .filter((p) => p && typeof p === "object")
        .map((p) => ({
          id: String(p.id || ""),
          name: String(p.name || "").trim(),
          items: Array.isArray(p.items)
            ? p.items.map((v) => String(v || "").trim()).filter(Boolean)
            : [],
        }))
        .filter((p) => p.id && p.name)
      : [];
    return { playlists };
  }

  async function loadPlaylistsState(parseApiResponse) {
    try {
      const response = await fetch("/api/settings");
      const result = await parseApiResponse(response);
      if (!result.ok) return { playlists: [] };
      return normalizePlaylistsState(result.data?.playlistsState);
    } catch (_error) {
      return { playlists: [] };
    }
  }

  function createPlaylistPageController({ parseApiResponse, appState }) {
    const grid = document.getElementById("playlist-page-grid");

    function isPlaylistPageActive() {
      return document.getElementById("page-playlists")?.classList.contains("active-page");
    }

    function renderEmpty(message) {
      if (!grid) return;
      grid.innerHTML = `<div class="home-video-empty">${message}</div>`;
    }

    function createCardElement(playlist, firstVideo, count, onOpen) {
      const card = document.createElement("div");
      card.className = "playlist-page-card";
      card.addEventListener("click", onOpen);

      const thumb = document.createElement("img");
      thumb.className = "playlist-page-thumb";
      thumb.loading = "lazy";
      thumb.decoding = "async";
      thumb.src = firstVideo?.thumb || "/none_icon.jpg";
      thumb.alt = playlist.name;
      thumb.onerror = () => {
        thumb.src = "/none_icon.jpg";
      };

      const body = document.createElement("div");
      body.className = "playlist-page-card-body";

      const title = document.createElement("div");
      title.className = "playlist-page-card-title";
      title.textContent = playlist.name;

      const meta = document.createElement("div");
      meta.className = "playlist-page-card-meta";
      meta.textContent = `${count.toLocaleString()} 本の動画`;

      const link = document.createElement("div");
      link.className = "playlist-page-card-link";
      link.textContent = "再生リストの全体を見る";

      body.appendChild(title);
      body.appendChild(meta);
      body.appendChild(link);
      card.appendChild(thumb);
      card.appendChild(body);
      return card;
    }

    function openFirstVideo(firstVideo) {
      if (!firstVideo?.filename) return;
      const videoId = firstVideo.filename.replace(/\.(mp4|mkv|webm|mov)$/i, "");
      appState.pendingVideoId = videoId;
      global.location.hash = `#player/${encodeURIComponent(videoId)}`;
      global.scrollTo(0, 0);
    }

    async function render() {
      if (!grid || !isPlaylistPageActive()) return;

      const state = await loadPlaylistsState(parseApiResponse);
      if (!state.playlists.length) {
        renderEmpty("プレイリストがありません");
        return;
      }

      try {
        const response = await fetch("/api/local-videos");
        const result = await parseApiResponse(response);
        if (!result.ok) {
          throw new Error(result.error || "ローカル動画一覧の取得に失敗しました。");
        }
        const videos = Array.isArray(result.data) ? result.data : [];
        const videoMap = new Map(videos.map((video) => [video.filename, video]));

        grid.innerHTML = "";
        let renderedCount = 0;
        state.playlists.forEach((playlist) => {
          const playableVideos = playlist.items
            .map((filename) => videoMap.get(filename))
            .filter(Boolean);
          if (playableVideos.length === 0) return;
          const firstVideo = playableVideos[0];
          const card = createCardElement(
            playlist,
            firstVideo,
            playableVideos.length,
            () => openFirstVideo(firstVideo),
          );
          grid.appendChild(card);
          renderedCount += 1;
        });

        if (renderedCount === 0) {
          renderEmpty("再生可能な動画があるプレイリストはありません");
        }
      } catch (error) {
        console.error("Failed to render playlists page:", error);
        renderEmpty("再生リストの読み込みに失敗しました");
      }
    }

    function initialize() {
      global.addEventListener("app:page-changed", (event) => {
        if (event?.detail?.pageId === "page-playlists") {
          render();
        }
      });
    }

    return {
      initialize,
      render,
    };
  }

  global.createPlaylistPageController = createPlaylistPageController;
})(window);
