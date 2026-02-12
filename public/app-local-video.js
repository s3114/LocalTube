(function attachLocalVideoModule(global) {
  function createLocalVideoModule({
    appState,
    parseApiResponse,
    formatUploadDateForDescription,
    formatChannelSubscribers,
    normalizeLiveChatBaseName,
    parseNdjsonMessages,
    getVideoIdFromFilename,
    createCommentRenderer,
    createChatLineElementFromMessage,
    onMetric = (_name, _value, _meta) => {},
    onError = (message, error) => console.error(message, error),
  }) {
    function createLocalVideoListItemElement(video, onClick) {
      const item = document.createElement("div");
      item.className = "local-video-item";
      item.dataset.filename = video.filename;

      if (video.thumb) {
        const thumbImg = document.createElement("img");
        thumbImg.src = video.thumb;
        thumbImg.className = "local-video-thumb";
        item.appendChild(thumbImg);
      } else {
        const thumbPlaceholder = document.createElement("div");
        thumbPlaceholder.className = "local-video-thumb";
        item.appendChild(thumbPlaceholder);
      }

      const textEl = document.createElement("div");
      textEl.className = "local-video-text";
      textEl.textContent = video.title;
      item.appendChild(textEl);

      item.addEventListener("click", () => onClick(video, item));
      return item;
    }

    function getVideoDataUiElements() {
      return {
        titleEl: document.getElementById("player-title"),
        youtubeBtn: document.getElementById("youtube-link-btn"),
        avatar: document.getElementById("channel-avatar"),
        channelLink: document.getElementById("channel-link"),
        channelHandle: document.getElementById("channel-handle"),
        channelSubs: document.getElementById("channel-subs"),
        avatarLink: document.getElementById("channel-avatar-link"),
        statLikes: document.getElementById("stat-likes"),
        descEl: document.getElementById("video-description"),
        commentList: document.getElementById("comment-list"),
        commentEmpty: document.querySelector(".comment-empty"),
        chatContainer: document.getElementById("chat-messages"),
        chatEmpty:
          document.querySelector("#live-chat-container .chat-empty") ||
          document.querySelector(".chat-empty"),
      };
    }

    function buildVideoDescriptionHeaderHtml(info) {
      const views = info.view_count
        ? `<b>${info.view_count.toLocaleString()}回視聴</b>`
        : "<b>視聴回数不明</b>";
      if (!info.upload_date) return views;
      return `${views} • <b>${formatUploadDateForDescription(info.upload_date)}</b>`;
    }

    function updateVideoDataPlayerHeader(ui, info) {
      if (ui.titleEl) {
        if (info.title && info.title.trim() !== "") {
          ui.titleEl.textContent = info.title;
        } else if (appState.lastSelectedFilename) {
          ui.titleEl.textContent = appState.lastSelectedFilename.replace(
            /\.(mp4|mkv|webm|mov)$/i,
            "",
          );
        } else {
          ui.titleEl.textContent = "無題";
        }
      }

      if (!ui.youtubeBtn) return;
      if (info.id) {
        ui.youtubeBtn.href = `https://www.youtube.com/watch?v=${info.id}`;
        ui.youtubeBtn.style.display = "inline-flex";
      } else {
        ui.youtubeBtn.style.display = "none";
      }
    }

    function updateVideoDataChannelInfo(ui, info) {
      if (
        !ui.avatar ||
        !ui.channelLink ||
        !ui.channelHandle ||
        !ui.channelSubs ||
        !ui.avatarLink
      ) {
        return;
      }

      ui.avatar.src = info.channel_thumbnail?.trim() || "/none_icon.jpg";
      ui.avatar.onerror = () => {
        ui.avatar.src = "/none_icon.jpg";
      };

      ui.channelLink.textContent = info.channel;
      ui.channelLink.href = info.channel_url;
      ui.avatarLink.href = info.channel_url;
      ui.channelHandle.textContent = info.uploader_id;
      ui.channelSubs.textContent = `${formatChannelSubscribers(info.channel_follower_count)} 登録`;
    }

    function updateVideoDataStats(ui, info) {
      if (!ui.statLikes) return;
      ui.statLikes.textContent = info.like_count
        ? info.like_count.toLocaleString()
        : "---";
    }

    function updateVideoDataDescription(ui, info, linkify, updateDescButton) {
      if (!ui.descEl) return;
      const descContent = info.description ? linkify(info.description) : "（概要欄なし）";
      ui.descEl.innerHTML = `${buildVideoDescriptionHeaderHtml(info)}<br><br>${descContent}`;
      ui.descEl.classList.add("collapsed");
      updateDescButton();
    }

    function resetVideoDataCommentDisplay(ui) {
      if (!ui.commentList || !ui.commentEmpty) return;
      ui.commentList.innerHTML = "";
      ui.commentEmpty.style.display = "none";
    }

    function renderVideoLiveChatMessages(chatContainer, messages) {
      messages.forEach((msg) => {
        const line = createChatLineElementFromMessage(msg);
        if (line) {
          chatContainer.appendChild(line);
        }
      });
    }

    function setVideoLiveChatLoadingState(ui, message) {
      if (!ui.chatContainer || !ui.chatEmpty) return;
      ui.chatContainer.innerHTML = "";
      ui.chatEmpty.style.display = "block";
      ui.chatEmpty.textContent = message;
    }

    function findLocalVideoById(videos, videoId) {
      if (!videoId) return null;
      const normalizedVideoId = String(videoId).trim();

      return videos.find((videoItem) => {
        if (!videoItem || !videoItem.filename) return false;
        const idFromFilename = videoItem.filename.replace(/\.(mp4|mkv|webm|mov)$/i, "");
        const titleText = String(videoItem.title || "").trim();
        return idFromFilename === normalizedVideoId || titleText === normalizedVideoId;
      });
    }

    function activateLocalVideoListItem(activeItem) {
      if (!activeItem) return;
      document
        .querySelectorAll(".local-video-item")
        .forEach((el) => el.classList.remove("active"));
      activeItem.classList.add("active");
    }

    function setupLocalVideoPlayerSource(videoPlayer, titleEl, onResetSeekBar, video) {
      videoPlayer.pause();
      videoPlayer.poster = video.thumb || "";
      videoPlayer.src = video.video;
      appState.lastSelectedFilename = video.filename;
      onResetSeekBar?.();
      videoPlayer.load();
      if (titleEl) titleEl.textContent = video.title;
    }

    function tryAutoplayLocalVideo(videoPlayer, shouldAutoplay) {
      const hasUserActivation =
        document.userActivation?.hasBeenActive || document.userActivation?.isActive;
      if (!shouldAutoplay || !hasUserActivation) return;
      videoPlayer.play().catch((err) => {
        if (err?.name !== "NotAllowedError") {
          onError("Play failed:", err);
        }
      });
    }

    function navigateToPlayerPageFromVideoId(videoId, onAfterNavigate) {
      history.pushState(null, "", `#player/${encodeURIComponent(videoId)}`);
      document
        .querySelectorAll(".page")
        .forEach((page) => page.classList.remove("active-page"));
      document.getElementById("page-player")?.classList.add("active-page");
      global.updateHeaderSearchVisibility?.("page-player");
      global.updateSmoothSeekLoopState?.();

      document.querySelectorAll(".icon-btn").forEach((button) => {
        if (button.dataset.page === "page-player") {
          button.classList.add("active");
        } else {
          button.classList.remove("active");
        }
      });

      onAfterNavigate?.();
    }

    function renderLocalVideoList(videoList, videos, onSelect) {
      videoList.innerHTML = "";
      if (videos.length === 0) {
        videoList.innerHTML = '<div class="status-subtext">動画が見つかりません</div>';
        return;
      }
      videos.forEach((video) => {
        videoList.appendChild(
          createLocalVideoListItemElement(video, (selectedVideo, selectedItem) =>
            onSelect(selectedVideo, selectedItem),
          ),
        );
      });
    }

    function showLocalVideoListLoadError(videoList, homeVideoGrid) {
      videoList.innerHTML =
        '<div class="status-warn-text">動画一覧の取得に失敗しました</div>';
      if (homeVideoGrid) {
        homeVideoGrid.innerHTML =
          '<div class="home-video-empty status-warn-text">動画一覧の取得に失敗しました</div>';
      }
    }

    function findLocalVideoListItem(videoList, filename) {
      return Array.from(videoList.querySelectorAll(".local-video-item")).find(
        (item) => item.dataset.filename === filename,
      );
    }

    function createVideoDataController({ linkify, updateDescButton }) {
      let infoAbortController = null;
      let infoRequestToken = 0;
      let chatAbortController = null;
      let chatRequestToken = 0;
      const ui = getVideoDataUiElements();
      const commentRenderer = createCommentRenderer(linkify);

      function applyVideoInfo(info) {
        updateVideoDataPlayerHeader(ui, info);
        updateVideoDataChannelInfo(ui, info);
        updateVideoDataStats(ui, info);
        updateVideoDataDescription(ui, info, linkify, updateDescButton);
        resetVideoDataCommentDisplay(ui);

        global.currentVideoComments = commentRenderer.extractRenderableComments(info);
        commentRenderer.renderComments(global.currentVideoComments);
      }

      async function loadLiveChat(videoBaseName) {
        const startedAt = performance.now();
        chatRequestToken += 1;
        const currentChatToken = chatRequestToken;
        if (chatAbortController) {
          chatAbortController.abort();
        }
        chatAbortController = new AbortController();

        try {
          if (!ui.chatContainer) {
            onError("chat-messages が見つかりません");
            return;
          }

          setVideoLiveChatLoadingState(ui, "チャットを読み込み中…");

          const base = normalizeLiveChatBaseName(videoBaseName);
          const res = await fetch(`/api/live-chat/${encodeURIComponent(base)}`, {
            signal: chatAbortController.signal,
          });
          const text = await res.text();
          if (currentChatToken !== chatRequestToken) return;
          const messages = parseNdjsonMessages(text);

          if (messages.length === 0) {
            if (ui.chatEmpty) ui.chatEmpty.textContent = "チャットがありません";
            onMetric("chat_load_ms", performance.now() - startedAt, {
              count: 0,
            });
            return;
          }

          if (ui.chatEmpty) ui.chatEmpty.style.display = "none";
          renderVideoLiveChatMessages(ui.chatContainer, messages);
          ui.chatContainer.scrollTop = ui.chatContainer.scrollHeight;
          onMetric("chat_load_ms", performance.now() - startedAt, {
            count: messages.length,
          });
        } catch (error) {
          if (error?.name === "AbortError") return;
          onError("loadLiveChat error:", error);
          if (ui.chatEmpty) ui.chatEmpty.textContent = "チャットの読み込みに失敗しました";
        }
      }

      function loadCurrentVideoSideData(videoId) {
        const startedAt = performance.now();
        infoRequestToken += 1;
        const currentInfoToken = infoRequestToken;
        if (infoAbortController) {
          infoAbortController.abort();
        }
        infoAbortController = new AbortController();

        fetch(`/info/${encodeURIComponent(videoId)}`, {
          signal: infoAbortController.signal,
        })
          .then((r) => r.json())
          .then((info) => {
            if (currentInfoToken !== infoRequestToken) return;
            applyVideoInfo(info);
            onMetric("info_load_ms", performance.now() - startedAt, { videoId });
          })
          .catch((error) => {
            if (error?.name === "AbortError") return;
            onError("info.json 読み込み失敗:", error);
          });

        loadLiveChat(videoId);
      }

      return {
        loadCurrentVideoSideData,
        renderSortedComments(sorted) {
          commentRenderer.renderComments(sorted);
        },
      };
    }

    function createLocalVideoController({
      videoPlayer,
      videoList,
      homeVideoGrid,
      titleEl,
      onResetSeekBar,
      onLoadSideData,
      onAfterNavigate,
      onRenderHomeVideos,
      onPrefetchHomeInfos,
    }) {
      let allLocalVideos = [];

      function scheduleHomeInfoPrefetch() {
        if (!onPrefetchHomeInfos) return;
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(() => onPrefetchHomeInfos());
          return;
        }
        setTimeout(() => onPrefetchHomeInfos(), 0);
      }

      function playLocalVideo(video, activeItem = null, shouldAutoplay = true) {
        const videoId = getVideoIdFromFilename(video.filename);
        activateLocalVideoListItem(activeItem);
        setupLocalVideoPlayerSource(videoPlayer, titleEl, onResetSeekBar, video);
        tryAutoplayLocalVideo(videoPlayer, shouldAutoplay);
        navigateToPlayerPageFromVideoId(videoId, onAfterNavigate);
        // 再生開始の体感を優先して、重いサイド情報処理は次フレームへ遅延
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => {
            onLoadSideData?.(videoId);
          });
        } else {
          setTimeout(() => {
            onLoadSideData?.(videoId);
          }, 0);
        }
      }

      async function loadLocalVideos() {
        const startedAt = performance.now();
        try {
          const res = await fetch("/api/local-videos");
          const result = await parseApiResponse(res);
          if (!result.ok) {
            throw new Error(result.error || "動画一覧の取得に失敗しました。");
          }
          const videos = result.data;
          allLocalVideos = Array.isArray(videos) ? videos : [];

          renderLocalVideoList(videoList, allLocalVideos, playLocalVideo);
          onRenderHomeVideos?.(allLocalVideos);
          scheduleHomeInfoPrefetch();

          if (appState.pendingVideoId) {
            const matchedVideo = findLocalVideoById(allLocalVideos, appState.pendingVideoId);
            if (matchedVideo) {
              const matchedItem = findLocalVideoListItem(
                videoList,
                matchedVideo.filename,
              );
              playLocalVideo(matchedVideo, matchedItem || null, false);
              appState.pendingVideoId = null;
            }
          }
          onMetric("local_videos_load_ms", performance.now() - startedAt, {
            count: allLocalVideos.length,
          });
        } catch (error) {
          onError("Failed to load local videos:", error);
          showLocalVideoListLoadError(videoList, homeVideoGrid);
        }
      }

      return {
        playLocalVideo,
        loadLocalVideos,
      };
    }

    return {
      createVideoDataController,
      createLocalVideoController,
    };
  }

  global.createLocalVideoModule = createLocalVideoModule;
})(window);
