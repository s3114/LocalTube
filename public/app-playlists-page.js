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
    const PLAYLIST_HASH_PREFIX = "#playlists/";

    function isPlaylistPageActive() {
      return document.getElementById("page-playlists")?.classList.contains("active-page");
    }

    function renderEmpty(message) {
      if (!grid) return;
      grid.innerHTML = `<div class="home-video-empty">${message}</div>`;
    }

    function getPlaylistIdFromHash() {
      const hash = String(global.location?.hash || "");
      if (!hash.startsWith(PLAYLIST_HASH_PREFIX)) return "";
      return decodeURIComponent(hash.slice(PLAYLIST_HASH_PREFIX.length)).trim();
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

      body.appendChild(title);
      body.appendChild(meta);
      card.appendChild(thumb);
      card.appendChild(body);
      return card;
    }

    function createPlaylistVideoRow(video, onOpen) {
      const row = document.createElement("div");
      row.className = "playlist-page-video-row";
      row.addEventListener("click", onOpen);

      const thumb = document.createElement("img");
      thumb.className = "playlist-page-video-thumb";
      thumb.loading = "lazy";
      thumb.decoding = "async";
      thumb.src = video?.thumb || "/none_icon.jpg";
      thumb.alt = video?.title || video?.filename || "video";
      thumb.onerror = () => {
        thumb.src = "/none_icon.jpg";
      };

      const body = document.createElement("div");
      body.className = "playlist-page-video-body";

      const title = document.createElement("div");
      title.className = "playlist-page-video-title";
      title.textContent = video?.title || video?.filename || "無題";

      const meta = document.createElement("div");
      meta.className = "playlist-page-video-meta";
      meta.textContent = video?.filename || "";

      body.appendChild(title);
      body.appendChild(meta);
      row.appendChild(thumb);
      row.appendChild(body);
      return row;
    }

    function openPlaylistDetail(playlistId) {
      if (!playlistId) return;
      history.pushState(null, "", `#playlists/${encodeURIComponent(playlistId)}`);
      render();
    }

    function createBackButton(onBack) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "playlist-page-back-btn";
      button.innerHTML = '<i class="fa-solid fa-chevron-left"></i> プレイリスト一覧へ戻る';
      button.addEventListener("click", onBack);
      return button;
    }

    function createPlaylistSummaryCard(playlist, firstVideo, videoCount) {
      const card = document.createElement("div");
      card.className = "playlist-summary-card";

      const thumb = document.createElement("img");
      thumb.className = "playlist-summary-thumb";
      thumb.loading = "lazy";
      thumb.decoding = "async";
      thumb.src = firstVideo?.thumb || "/none_icon.jpg";
      thumb.alt = playlist?.name || "playlist";
      thumb.onerror = () => {
        thumb.src = "/none_icon.jpg";
      };

      const title = document.createElement("div");
      title.className = "playlist-summary-title";
      title.textContent = playlist?.name || "プレイリスト";

      const meta = document.createElement("div");
      meta.className = "playlist-summary-meta";
      meta.textContent = `${Number(videoCount || 0).toLocaleString()} 本の動画`;

      card.appendChild(thumb);
      card.appendChild(title);
      card.appendChild(meta);
      return card;
    }

    function openFirstVideo(firstVideo, playlistId = "", playlistIndex = null) {
      if (!firstVideo?.filename) return;
      const videoId = firstVideo.filename.replace(/\.(mp4|mkv|webm|mov)$/i, "");
      const listIdText = String(playlistId || "").trim();
      const indexNum = Number.isFinite(Number(playlistIndex))
        ? Math.max(1, Number(playlistIndex) + 1)
        : null;
      const immediatePlayed = typeof global.playLocalVideoById === "function"
        ? global.playLocalVideoById(videoId, {
          shouldAutoplay: true,
          playlistMeta: {
            listId: listIdText,
            index: indexNum ? String(indexNum) : "",
          },
        })
        : false;
      if (immediatePlayed) {
        return;
      }

      appState.pendingVideoId = videoId;
      appState.pendingAutoplay = true;
      appState.pendingPlaylistId = listIdText;
      appState.pendingPlaylistIndex = Number.isFinite(Number(playlistIndex))
        ? String(Math.max(1, Number(playlistIndex) + 1))
        : "";
      const suffix = listIdText
        ? `&list=${encodeURIComponent(listIdText)}${indexNum ? `&index=${indexNum}` : ""}`
        : "";
      global.location.hash = `#player/${encodeURIComponent(videoId)}${suffix}`;
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
        const selectedPlaylistId = getPlaylistIdFromHash();

        grid.innerHTML = "";
        if (selectedPlaylistId) {
          const selectedPlaylist = state.playlists.find((playlist) => playlist.id === selectedPlaylistId);
          if (!selectedPlaylist) {
            renderEmpty("指定されたプレイリストが見つかりません");
            return;
          }

          const playableVideos = selectedPlaylist.items
            .map((filename) => videoMap.get(filename))
            .filter(Boolean);
          if (playableVideos.length === 0) {
            const backButton = createBackButton(() => {
              history.pushState(null, "", "#playlists");
              render();
            });
            grid.appendChild(backButton);
            const empty = document.createElement("div");
            empty.className = "home-video-empty";
            empty.textContent = "プレイリストに再生可能な動画がありません";
            grid.appendChild(empty);
            return;
          }

          const backButton = createBackButton(() => {
            history.pushState(null, "", "#playlists");
            render();
          });
          const detailLayout = document.createElement("div");
          detailLayout.className = "playlist-page-detail-layout";

          const side = document.createElement("aside");
          side.className = "playlist-page-detail-side";
          side.appendChild(backButton);
          side.appendChild(
            createPlaylistSummaryCard(selectedPlaylist, playableVideos[0], playableVideos.length),
          );

          const list = document.createElement("section");
          list.className = "playlist-page-video-list";
          playableVideos.forEach((video, index) => {
            list.appendChild(
              createPlaylistVideoRow(
                video,
                () => openFirstVideo(video, selectedPlaylist.id, index),
              ),
            );
          });

          detailLayout.appendChild(side);
          detailLayout.appendChild(list);
          grid.appendChild(detailLayout);
          return;
        }

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
            () => openPlaylistDetail(playlist.id),
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
      global.addEventListener("hashchange", () => {
        if (isPlaylistPageActive()) {
          render();
        }
      });
      if (isPlaylistPageActive()) {
        render();
      }
    }

    return {
      initialize,
      render,
    };
  }

  global.createPlaylistPageController = createPlaylistPageController;
})(window);
