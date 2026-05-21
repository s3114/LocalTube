(function attachLocalVideoModule(global) {
  const LEGACY_PLAYLIST_STORAGE_KEY = "localtube.playlists.v1";
  const WATCH_LATER_PLAYLIST_ID = "watch_later_default";
  const WATCH_LATER_PLAYLIST_NAME = "後で見る";

  function createLocalVideoModule({
    appState,
    parseApiResponse,
    formatUploadDateForDescription,
    formatChannelSubscribers,
    normalizeLiveChatBaseName,
    parseNdjsonMessages,
    extractNonEmptyNdjsonLines,
    getVideoIdFromFilename,
    createCommentRenderer,
    createChatLineElementFromMessage,
    onMetric = (_name, _value, _meta) => {},
    onError = (message, error) => console.error(message, error),
    showConfirm = async () => true,
    showSuccess = (_message) => {},
  }) {
    function getPreferredVideoId(video) {
      return String(video?.videoId || "").trim() || getVideoIdFromFilename(video?.filename);
    }

    function formatDurationHhMmSs(value) {
      const totalSeconds = Math.max(0, Math.round(Number(value)));
      if (!Number.isFinite(totalSeconds)) return "";
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;
      return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
    }

    function buildInlineHomeInfo(video) {
      const videoId = getPreferredVideoId(video);
      if (!videoId) return null;
      return {
        id: videoId,
        title: String(video?.title || "").trim(),
        channel: String(video?.channelName || "").trim(),
        channel_thumbnail: String(video?.channelThumbnail || "").trim(),
        duration: Number.isFinite(Number(video?.duration)) ? Number(video.duration) : null,
        live_status: String(video?.liveStatus || "").trim(),
        is_live: video?.isLive === true,
        was_live: video?.wasLive === true,
        webpage_url: String(video?.webpageUrl || "").trim(),
        upload_date: String(video?.uploadDate || "").trim(),
        view_count: Number.isFinite(Number(video?.viewCount)) ? Number(video.viewCount) : null,
      };
    }

    async function copyTextToClipboard(text) {
      const value = String(text || "");
      if (global.navigator?.clipboard?.writeText && global.isSecureContext) {
        await global.navigator.clipboard.writeText(value);
        return;
      }
      const input = document.createElement("input");
      input.value = value;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      input.style.pointerEvents = "none";
      document.body.appendChild(input);
      input.focus();
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }

    function ensureWatchLaterPlaylist(playlists) {
      const source = Array.isArray(playlists) ? playlists : [];
      const hasWatchLater = source.some((playlist) => playlist.id === WATCH_LATER_PLAYLIST_ID);
      if (hasWatchLater) {
        return source.map((playlist) =>
          playlist.id === WATCH_LATER_PLAYLIST_ID
            ? { ...playlist, name: WATCH_LATER_PLAYLIST_NAME }
            : playlist,
        );
      }
      return [
        {
          id: WATCH_LATER_PLAYLIST_ID,
          name: WATCH_LATER_PLAYLIST_NAME,
          items: [],
        },
        ...source,
      ];
    }

    function normalizePlaylistsState(rawState) {
      const source = rawState && typeof rawState === "object" ? rawState : {};
      const playlists = ensureWatchLaterPlaylist(Array.isArray(source.playlists)
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
        : []);
      const selectedId = String(source.selectedId || "").trim();
      return {
        playlists,
        selectedId:
          selectedId && playlists.some((p) => p.id === selectedId)
            ? selectedId
            : playlists[0]?.id || "",
      };
    }

    function loadPlaylistsState() {
      return normalizePlaylistsState({ playlists: [], selectedId: "" });
    }

    function loadLegacyPlaylistsState() {
      try {
        const raw = global.localStorage?.getItem(LEGACY_PLAYLIST_STORAGE_KEY);
        if (!raw) return loadPlaylistsState();
        return normalizePlaylistsState(JSON.parse(raw));
      } catch (_error) {
        return loadPlaylistsState();
      }
    }

    async function fetchPlaylistsState() {
      try {
        const response = await fetch("/api/settings");
        const result = await parseApiResponse(response);
        if (!result.ok) return loadPlaylistsState();
        const serverState = normalizePlaylistsState(result.data?.playlistsState);
        if ((serverState.playlists || []).length > 1) {
          return serverState;
        }

        const legacyState = loadLegacyPlaylistsState();
        if ((legacyState.playlists || []).length > 1) {
          await savePlaylistsState(legacyState);
          return legacyState;
        }
        return serverState;
      } catch (_error) {
        return loadPlaylistsState();
      }
    }

    async function savePlaylistsState(state) {
      const normalized = normalizePlaylistsState(state);
      try {
        await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playlistsState: normalized }),
        });
      } catch (_error) {
        // no-op
      }
    }

    function createPlaylistId() {
      return `pl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function createLocalVideoThumbLazyLoader(container) {
      let observer = null;

      function hydrateThumb(img) {
        if (!(img instanceof HTMLImageElement)) return;
        const src = String(img.dataset.thumbSrc || "").trim();
        if (!src) return;
        img.src = src;
        delete img.dataset.thumbSrc;
      }

      function observe() {
        if (!container) return;
        const pendingImages = container.querySelectorAll(
          "img.local-video-thumb[data-thumb-src]",
        );
        if (!pendingImages.length) return;

        if (!("IntersectionObserver" in global)) {
          pendingImages.forEach(hydrateThumb);
          return;
        }

        if (!observer) {
          observer = new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                if (!entry.isIntersecting) return;
                hydrateThumb(entry.target);
                observer?.unobserve(entry.target);
              });
            },
            {
              root: container,
              rootMargin: "240px 0px",
            },
          );
        }

        pendingImages.forEach((img) => observer.observe(img));
      }

      function disconnect() {
        observer?.disconnect();
        observer = null;
      }

      return {
        observe,
        disconnect,
      };
    }

    function applyLocalVideoListItemInfo(item, video, info) {
      if (!item) return;
      const textEl = item.querySelector(".local-video-text");
      const titleEl = item.querySelector(".local-video-item-title");
      const channelEl = item.querySelector(".local-video-item-channel");
      const metaEl = item.querySelector(".local-video-item-meta");
      if (!textEl || !titleEl || !channelEl || !metaEl) return;
      const resolvedTitle = String(info?.title || "").trim() || video.title;
      const resolvedChannel = String(info?.channel || "").trim() || "ローカル動画";
      const resolvedViews = Number.isFinite(Number(info?.view_count))
        ? `${Number(info.view_count).toLocaleString()}回視聴`
        : "視聴回数不明";
      const resolvedDate = String(info?.upload_date || "").trim()
        ? formatUploadDateForDescription(info.upload_date)
        : "投稿日不明";
      const resolvedDuration = Number.isFinite(Number(info?.duration))
        ? formatDurationHhMmSs(info.duration)
        : Number.isFinite(Number(video?.duration))
          ? formatDurationHhMmSs(video.duration)
          : "";
      titleEl.textContent = resolvedTitle;
      channelEl.textContent = resolvedChannel;
      metaEl.textContent = [resolvedDuration, resolvedViews, resolvedDate].filter(Boolean).join(" ・ ");
      textEl.title = resolvedTitle;
    }

    function createLocalVideoListItemElement(video, onClick, onOpenOptions) {
      const item = document.createElement("div");
      item.className = "local-video-item";
      item.dataset.filename = video.filename;
      item.dataset.videoId =
        String(video.videoId || "").trim() || getVideoIdFromFilename(video.filename) || "";

      if (video.thumb) {
        const thumbImg = document.createElement("img");
        thumbImg.className = "local-video-thumb";
        thumbImg.dataset.thumbSrc = video.thumb;
        thumbImg.loading = "lazy";
        thumbImg.decoding = "async";
        thumbImg.alt = video.title || video.filename || "thumbnail";
        thumbImg.onerror = () => {
          thumbImg.src = "/none_icon.jpg";
        };
        item.appendChild(thumbImg);
      } else {
        const thumbPlaceholder = document.createElement("div");
        thumbPlaceholder.className = "local-video-thumb";
        item.appendChild(thumbPlaceholder);
      }

      const textEl = document.createElement("div");
      textEl.className = "local-video-text";
      textEl.title = video.title;

      const titleEl = document.createElement("div");
      titleEl.className = "local-video-item-title";
      titleEl.textContent = video.title;

      const channelEl = document.createElement("div");
      channelEl.className = "local-video-item-channel";
      channelEl.textContent = String(video?.channelName || "").trim() || "ローカル動画";

      const metaEl = document.createElement("div");
      metaEl.className = "local-video-item-meta";
      metaEl.textContent = Number.isFinite(Number(video?.duration))
        ? formatDurationHhMmSs(video.duration)
        : "視聴回数不明・投稿日不明";

      textEl.appendChild(titleEl);
      textEl.appendChild(channelEl);
      textEl.appendChild(metaEl);
      item.appendChild(textEl);

      const optionBtn = document.createElement("button");
      optionBtn.className = "local-video-option-btn";
      optionBtn.type = "button";
      optionBtn.title = "オプション";
      optionBtn.innerHTML = '<i class="fa-solid fa-ellipsis-vertical"></i>';
      optionBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        onOpenOptions?.(video, optionBtn);
      });
      item.appendChild(optionBtn);

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
        ? `${info.view_count.toLocaleString()}回視聴`
        : "視聴回数不明";
      if (!info.upload_date) return views;
      return `${views} • ${formatUploadDateForDescription(info.upload_date)}`;
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
      ui.descEl.innerHTML = `<div class="yt-description-content collapsed">${buildVideoDescriptionHeaderHtml(info)}<br>${descContent}</div><button type="button" class="yt-desc-collapse-btn">折りたたむ</button>`;
      updateDescButton();
    }

    function resetVideoDataCommentDisplay(ui) {
      if (!ui.commentList || !ui.commentEmpty) return;
      ui.commentList.innerHTML = "";
      ui.commentEmpty.style.display = "none";
    }

    function createChatReplayState(chatContainer, videoBaseName) {
      const replayState = {
        mode: "windowed",
        videoBaseName,
        windowBeforeSec: 20,
        windowAfterSec: 45,
        preloadAheadSec: 15,
        limit: 400,
        maxRendered: 250,
        queue: [],
        currentRangeStartSec: 0,
        currentRangeEndSec: 0,
        hasMoreAfter: true,
        hasMoreBefore: false,
        isFetching: false,
        requestVersion: 0,
        lastSyncSec: -1,
      };
      chatContainer.__chatReplayState = replayState;
      chatContainer.__chatRenderCompleted = true;
      chatContainer.__chatTimedLines = [];
      chatContainer.__chatTimedIndex = 0;
      chatContainer.__lastSyncedSecond = undefined;
      chatContainer.__lastChatTargetTime = "";
      return replayState;
    }

    function resetChatReplayState(chatContainer, videoBaseName) {
      if (!chatContainer) return null;
      chatContainer.innerHTML = "";
      chatContainer.__chatUserPausedUntil = 0;
      return createChatReplayState(chatContainer, videoBaseName);
    }

    function getReplayTimeSecFromMessage(msg) {
      const niconicoTimeMs = Number(msg?.vposMs);
      if (Number.isFinite(niconicoTimeMs)) return Math.floor(niconicoTimeMs / 1000);

      const rawTimeMs = msg?.replayChatItemAction?.videoOffsetTimeMsec;
      const timeMs = Number(rawTimeMs);
      return Number.isFinite(timeMs) ? Math.floor(timeMs / 1000) : null;
    }

    function trimRenderedChatLines(chatContainer, maxRendered) {
      while (chatContainer.childElementCount > maxRendered) {
        chatContainer.firstElementChild?.remove();
      }
    }

    function scrollChatReplayToBottom(chatContainer, { force = false } = {}) {
      if (!chatContainer) return;
      if (!force && Number(chatContainer.__chatUserPausedUntil || 0) > Date.now()) {
        return;
      }
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    function appendReplayMessages(chatContainer, messages, { forceScroll = false } = {}) {
      if (!chatContainer || !Array.isArray(messages) || messages.length === 0) return;
      const fragment = document.createDocumentFragment();
      messages.forEach((msg) => {
        const line = createChatLineElementFromMessage(msg);
        if (!line) return;
        fragment.appendChild(line);
      });
      chatContainer.appendChild(fragment);
      const replayState = chatContainer.__chatReplayState;
      trimRenderedChatLines(chatContainer, replayState?.maxRendered || 250);
      scrollChatReplayToBottom(chatContainer, { force: forceScroll });
    }

    async function fetchChatReplayWindow(
      videoBaseName,
      startSec,
      endSec,
      limit,
      signal = undefined,
    ) {
      const base = normalizeLiveChatBaseName(videoBaseName);
      const query = new URLSearchParams({
        startSec: String(Math.max(0, Math.floor(startSec))),
        endSec: String(Math.max(0, Math.floor(endSec))),
        limit: String(Math.max(1, limit || 400)),
      });
      const response = await fetch(
        `/api/live-chat/${encodeURIComponent(base)}?${query.toString()}`,
        { signal },
      );
      const parsed = await parseApiResponse(response);
      if (response.status === 404) {
        return {
          missing: true,
          items: [],
          startSec: Math.max(0, Math.floor(startSec)),
          endSec: Math.max(0, Math.floor(endSec)),
          hasMoreAfter: false,
          hasMoreBefore: false,
        };
      }
      if (!parsed.ok) {
        throw new Error(parsed.error || "ライブチャットの取得に失敗しました");
      }
      return parsed.data || parsed.raw || {};
    }

    async function loadChatReplayWindowForTime(chatContainer, videoBaseName, currentSec) {
      const replayState =
        resetChatReplayState(chatContainer, videoBaseName) ||
        createChatReplayState(chatContainer, videoBaseName);
      const startSec = Math.max(0, currentSec - replayState.windowBeforeSec);
      const endSec = currentSec + replayState.windowAfterSec;
      replayState.requestVersion += 1;
      const requestVersion = replayState.requestVersion;
      replayState.isFetching = true;
      const payload = await fetchChatReplayWindow(
        videoBaseName,
        startSec,
        endSec,
        replayState.limit,
        undefined,
      );
      if (requestVersion !== replayState.requestVersion) return;
      if (payload?.missing) {
        replayState.currentRangeStartSec = startSec;
        replayState.currentRangeEndSec = endSec;
        replayState.hasMoreAfter = false;
        replayState.hasMoreBefore = false;
        replayState.queue = [];
        replayState.lastSyncSec = currentSec;
        replayState.isFetching = false;
        chatContainer.__chatRenderCompleted = true;
        chatContainer.innerHTML = "";
        chatContainer.__chatTimedLines = [];
        chatContainer.__chatTimedIndex = 0;
        chatContainer.__lastSyncedSecond = undefined;
        chatContainer.__lastChatTargetTime = "";
        return;
      }

      replayState.currentRangeStartSec = payload.startSec ?? startSec;
      replayState.currentRangeEndSec = payload.endSec ?? endSec;
      replayState.hasMoreAfter = payload.hasMoreAfter !== false;
      replayState.hasMoreBefore = payload.hasMoreBefore === true;

      const items = Array.isArray(payload.items) ? payload.items : [];
      const past = [];
      const future = [];
      items.forEach((msg) => {
        const timeSec = getReplayTimeSecFromMessage(msg);
        if (!Number.isFinite(timeSec)) return;
        if (timeSec <= currentSec) {
          past.push(msg);
        } else {
          future.push(msg);
        }
      });

      appendReplayMessages(chatContainer, past.slice(-replayState.maxRendered), {
        forceScroll: true,
      });
      replayState.queue = future;
      replayState.lastSyncSec = currentSec;
      replayState.isFetching = false;
      chatContainer.__chatRenderCompleted = true;
    }

    async function primeFutureChatReplayWindow(chatContainer, currentSec, maxWindows = 8) {
      const replayState = chatContainer?.__chatReplayState;
      if (!chatContainer || !replayState) return 0;
      if ((replayState.queue?.length || 0) > 0) return replayState.queue.length;

      let probeStartSec = replayState.currentRangeEndSec + 1;
      for (let attempt = 0; attempt < maxWindows; attempt += 1) {
        if (!replayState.hasMoreAfter) break;
        const probeEndSec = probeStartSec + replayState.windowAfterSec;
        const payload = await fetchChatReplayWindow(
          replayState.videoBaseName,
          probeStartSec,
          probeEndSec,
          replayState.limit,
          undefined,
        );
        if (payload?.missing) {
          replayState.hasMoreAfter = false;
          replayState.hasMoreBefore = false;
          replayState.queue = [];
          return 0;
        }

        replayState.currentRangeStartSec = payload.startSec ?? probeStartSec;
        replayState.currentRangeEndSec = payload.endSec ?? probeEndSec;
        replayState.hasMoreAfter = payload.hasMoreAfter !== false;
        replayState.hasMoreBefore = true;

        const items = Array.isArray(payload.items) ? payload.items : [];
        const future = items.filter((msg) => {
          const timeSec = getReplayTimeSecFromMessage(msg);
          return Number.isFinite(timeSec) && timeSec > currentSec;
        });
        if (future.length > 0) {
          replayState.queue = future;
          return future.length;
        }

        probeStartSec = replayState.currentRangeEndSec + 1;
      }

      return 0;
    }

    async function fetchNextChatReplayWindow(chatContainer, currentSec) {
      const replayState = chatContainer?.__chatReplayState;
      if (!chatContainer || !replayState || replayState.isFetching || !replayState.hasMoreAfter) {
        return;
      }

      if (currentSec + replayState.preloadAheadSec < replayState.currentRangeEndSec) {
        return;
      }

      replayState.isFetching = true;
      replayState.requestVersion += 1;
      const requestVersion = replayState.requestVersion;
      const nextStartSec = replayState.currentRangeEndSec + 1;
      const nextEndSec = nextStartSec + replayState.windowAfterSec;

      try {
        const payload = await fetchChatReplayWindow(
          replayState.videoBaseName,
          nextStartSec,
          nextEndSec,
          replayState.limit,
          undefined,
        );
        if (requestVersion !== replayState.requestVersion) return;
        if (payload?.missing) {
          replayState.currentRangeEndSec = nextEndSec;
          replayState.hasMoreAfter = false;
          replayState.hasMoreBefore = false;
          return;
        }

        const items = Array.isArray(payload.items) ? payload.items : [];
        replayState.queue.push(...items);
        replayState.currentRangeEndSec = payload.endSec ?? nextEndSec;
        replayState.hasMoreAfter = payload.hasMoreAfter !== false;
      } catch (error) {
        onError("loadNextLiveChatWindow error:", error);
      } finally {
        if (requestVersion === replayState.requestVersion) {
          replayState.isFetching = false;
        }
      }
    }

    function syncChatReplayWithPlayback(chatContainer, currentSec, { force = false } = {}) {
      const replayState = chatContainer?.__chatReplayState;
      if (!chatContainer || !replayState || replayState.mode !== "windowed") {
        return false;
      }

      if (force) {
        void loadChatReplayWindowForTime(
          chatContainer,
          replayState.videoBaseName,
          currentSec,
        ).catch((error) => {
          onError("seeked live chat reload error:", error);
        });
        return true;
      }

      if (replayState.lastSyncSec === currentSec) return true;
      replayState.lastSyncSec = currentSec;

      const due = [];
      while (replayState.queue.length > 0) {
        const next = replayState.queue[0];
        const timeSec = getReplayTimeSecFromMessage(next);
        if (!Number.isFinite(timeSec) || timeSec > currentSec) break;
        due.push(replayState.queue.shift());
      }

      if (due.length > 0) {
        appendReplayMessages(chatContainer, due, { forceScroll: false });
      }

      void fetchNextChatReplayWindow(chatContainer, currentSec);
      return true;
    }

    function renderVideoLiveChatMessages(
      chatContainer,
      messageSource,
      {
        shouldContinue = () => true,
        onChunkRendered = () => {},
        onCompleted = () => {},
      } = {},
    ) {
      const timedLines = [];
      const chunkSize = 8;
      const chunkBudgetMs = 4;
      let offset = 0;
      const sourceItems = Array.isArray(messageSource)
        ? messageSource
        : extractNonEmptyNdjsonLines(messageSource);
      chatContainer.__chatRenderCompleted = false;

      const scheduleNextChunk = () => {
        if (typeof global.requestIdleCallback === "function") {
          global.requestIdleCallback(renderChunk, { timeout: 50 });
          return;
        }
        setTimeout(renderChunk, 16);
      };

      const renderChunk = () => {
        if (!shouldContinue()) return;
        const fragment = document.createDocumentFragment();
        const startedAt = performance.now();
        let renderedCount = 0;

        for (; offset < sourceItems.length; offset += 1) {
          const rawItem = sourceItems[offset];
          let msg = rawItem;
          if (typeof rawItem === "string") {
            try {
              msg = JSON.parse(rawItem);
            } catch (error) {
              console.warn("パース失敗した行:", rawItem, error);
              continue;
            }
          }
          const line = createChatLineElementFromMessage(msg);
          if (!line) continue;
          fragment.appendChild(line);
          const timeSec = Number.parseInt(line.dataset.time || "", 10);
          if (Number.isFinite(timeSec)) {
            timedLines.push({ timeSec, line });
          }
          renderedCount += 1;

          if (
            renderedCount >= chunkSize ||
            performance.now() - startedAt >= chunkBudgetMs
          ) {
            offset += 1;
            break;
          }
        }

        chatContainer.appendChild(fragment);
        chatContainer.__chatTimedLines = timedLines;
        chatContainer.__chatTimedIndex = 0;
        chatContainer.__lastSyncedSecond = undefined;
        chatContainer.__lastChatTargetTime = "";
        onChunkRendered();

        if (offset >= sourceItems.length) {
          chatContainer.__chatRenderCompleted = true;
          onCompleted();
          return;
        }

        scheduleNextChunk();
      };

      scheduleNextChunk();
    }

    function setVideoLiveChatLoadingState(ui, message) {
      if (!ui.chatContainer || !ui.chatEmpty) return;
      ui.chatContainer.innerHTML = "";
      ui.chatContainer.__chatTimedLines = [];
      ui.chatContainer.__chatTimedIndex = 0;
      ui.chatContainer.__lastSyncedSecond = undefined;
      ui.chatContainer.__lastChatTargetTime = "";
      ui.chatContainer.__chatRenderCompleted = false;
      ui.chatContainer.__chatUserPausedUntil = 0;
      ui.chatContainer.__chatReplayState = null;
      ui.chatEmpty.style.display = "block";
      ui.chatEmpty.textContent = message;
    }

    function findLocalVideoById(videos, videoId) {
      if (!videoId) return null;
      const normalizedVideoId = String(videoId).trim();

      return videos.find((videoItem) => {
        if (!videoItem || !videoItem.filename) return false;
        const actualVideoId = String(videoItem.videoId || "").trim();
        const idFromFilename = videoItem.filename.replace(/\.(mp4|mkv|webm|mov)$/i, "");
        const titleText = String(videoItem.title || "").trim();
        return (
          actualVideoId === normalizedVideoId ||
          idFromFilename === normalizedVideoId ||
          titleText === normalizedVideoId
        );
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
      if (!shouldAutoplay) return;
      videoPlayer.play().catch((err) => {
        if (err?.name !== "NotAllowedError" && err?.name !== "AbortError") {
          onError("Play failed:", err);
        }
      });
    }

    function navigateToPlayerPageFromVideoId(videoId, onAfterNavigate, playlistMeta = null) {
      const encodedVideoId = encodeURIComponent(videoId);
      const listId = String(playlistMeta?.listId || "").trim();
      const index = String(playlistMeta?.index || "").trim();
      const hash = listId
        ? `#player/${encodedVideoId}&list=${encodeURIComponent(listId)}${index ? `&index=${encodeURIComponent(index)}` : ""}`
        : `#player/${encodedVideoId}`;
      history.pushState(null, "", hash);
      appState.lastPlayerHash = hash;
      window.scrollTo(0, 0);
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

    function renderLocalVideoList(videoList, videos, onSelect, onOpenOptions, onChunkRendered) {
      videoList.__localThumbLazyLoader?.disconnect?.();
      videoList.innerHTML = "";
      if (videos.length === 0) {
        videoList.innerHTML = '<div class="status-subtext">動画が見つかりません</div>';
        return;
      }
      const thumbLazyLoader = createLocalVideoThumbLazyLoader(videoList);
      videoList.__localThumbLazyLoader = thumbLazyLoader;
      const renderChunkSize = 40;
      let cursor = 0;

      function renderChunk() {
        const fragment = document.createDocumentFragment();
        const start = cursor;
        const end = Math.min(cursor + renderChunkSize, videos.length);
        for (; cursor < end; cursor += 1) {
          const video = videos[cursor];
          fragment.appendChild(
            createLocalVideoListItemElement(
              video,
              (selectedVideo, selectedItem) => onSelect(selectedVideo, selectedItem),
              onOpenOptions,
            ),
          );
        }
        videoList.appendChild(fragment);
        thumbLazyLoader.observe();
        onChunkRendered?.(videos.slice(start, end));

        if (cursor >= videos.length) return;
        if (typeof global.requestAnimationFrame === "function") {
          global.requestAnimationFrame(renderChunk);
          return;
        }
        setTimeout(renderChunk, 0);
      }

      renderChunk();
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
      let chatLoadTimerId = null;
      const ui = getVideoDataUiElements();
      const commentRenderer = createCommentRenderer(linkify);

      async function loadCommentEmojiMap(videoBaseName) {
        try {
          const response = await fetch(
            `/api/live-chat-emoji-map/${encodeURIComponent(videoBaseName)}`,
          );
          if (!response.ok) {
            commentRenderer.setEmojiMap([]);
            return;
          }
          const payload = await response.json();
          commentRenderer.setEmojiMap(Array.isArray(payload?.items) ? payload.items : []);
        } catch (_error) {
          commentRenderer.setEmojiMap([]);
        }
      }

      function applyVideoInfo(info) {
        updateVideoDataPlayerHeader(ui, info);
        updateVideoDataChannelInfo(ui, info);
        updateVideoDataStats(ui, info);
        updateVideoDataDescription(ui, info, linkify, updateDescButton);
        resetVideoDataCommentDisplay(ui);

        global.currentVideoComments = commentRenderer.extractRenderableComments(info);
        if (typeof global.applyCurrentCommentSortAndFilters === "function") {
          global.applyCurrentCommentSortAndFilters();
        } else {
          commentRenderer.renderComments(global.currentVideoComments);
        }
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
          if (currentChatToken !== chatRequestToken) return;
          const currentSec = Math.floor(Number(document.getElementById("local-player")?.currentTime) || 0);
          await loadChatReplayWindowForTime(ui.chatContainer, videoBaseName, currentSec);
          if (currentChatToken !== chatRequestToken) return;
          const replayState = ui.chatContainer.__chatReplayState;
          const initialCount =
            ui.chatContainer.childElementCount + (replayState?.queue?.length || 0);
          if (initialCount === 0) {
            const futureCount = replayState?.hasMoreAfter
              ? await primeFutureChatReplayWindow(ui.chatContainer, currentSec)
              : 0;
            if (currentChatToken !== chatRequestToken) return;
            if (futureCount > 0) {
              if (ui.chatEmpty) ui.chatEmpty.textContent = "この時間帯のチャットを待機中…";
              onMetric("chat_load_ms", performance.now() - startedAt, {
                count: futureCount,
                deferred: true,
              });
              return;
            }
            if (ui.chatEmpty) ui.chatEmpty.textContent = "チャットがありません";
            onMetric("chat_load_ms", performance.now() - startedAt, { count: 0 });
            return;
          }

          if (ui.chatEmpty) ui.chatEmpty.style.display = "none";
          onMetric("chat_load_ms", performance.now() - startedAt, {
            count: initialCount,
          });
        } catch (error) {
          if (error?.name === "AbortError") return;
          onError("loadLiveChat error:", error);
          if (ui.chatEmpty) ui.chatEmpty.textContent = "チャットの読み込みに失敗しました";
        }
      }

      function scheduleLiveChatLoad(videoBaseName, delayMs = 1500) {
        if (chatLoadTimerId) {
          clearTimeout(chatLoadTimerId);
        }
        chatLoadTimerId = setTimeout(() => {
          chatLoadTimerId = null;
          loadLiveChat(videoBaseName);
        }, delayMs);
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
          .then(async (info) => {
            await loadCommentEmojiMap(videoId);
            if (currentInfoToken !== infoRequestToken) return;
            applyVideoInfo(info);
            onMetric("info_load_ms", performance.now() - startedAt, { videoId });
          })
          .catch((error) => {
            if (error?.name === "AbortError") return;
            onError("info.json 読み込み失敗:", error);
          });

        scheduleLiveChatLoad(videoId);
      }

      return {
        loadCurrentVideoSideData,
        syncChatReplayForCurrentTime(currentSec, options) {
          return syncChatReplayWithPlayback(ui.chatContainer, currentSec, options);
        },
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
      const localVideoById = new Map();
      let playlistsState = loadPlaylistsState();
      const transientQueue = [];
      let currentPlaylistPlayback = { listId: "", index: "" };
      const localVideoInfoData = new Map();
      const requestedLocalVideoInfoIds = new Set();
      let localVideoInfoPrefetchPromise = null;
      let pendingLocalVideoInfoIds = [];
      let optionMenuVideo = null;
      let playlistSaveTargetVideo = null;
      let playlistModalTargetVideo = null;
      const playlistSelectEl = document.getElementById("playlist-select");
      const playlistNameInputEl = document.getElementById("playlist-name-input");
      const playlistCreateBtnEl = document.getElementById("playlist-create-btn");
      const playlistDeleteBtnEl = document.getElementById("playlist-delete-btn");
      const playlistAddCurrentBtnEl = document.getElementById("playlist-add-current-btn");
      const playlistItemsEl = document.getElementById("playlist-items");
      const playbackPlaylistSectionEl = document.getElementById("playback-playlist-section");
      const playbackPlaylistItemsEl = document.getElementById("playback-playlist-items");
      const playbackPlaylistTitleEl = document.getElementById("playback-playlist-title");
      const optionsMenuEl = document.createElement("div");
      optionsMenuEl.className = "local-video-options-menu hidden";
      optionsMenuEl.innerHTML = `
        <button type="button" class="local-video-options-item" data-action="queue">
          <i class="fa-solid fa-list"></i>キューに追加
        </button>
        <button type="button" class="local-video-options-item" data-action="watch-later">
          <i class="fa-regular fa-clock"></i>「後で見る」に保存
        </button>
        <button type="button" class="local-video-options-item" data-action="save-playlist">
          <i class="fa-regular fa-bookmark"></i>再生リストに保存
        </button>
        <button type="button" class="local-video-options-item" data-action="share">
          <i class="fa-solid fa-share-nodes"></i>共有
        </button>
        <button type="button" class="local-video-options-item" data-action="delete-local">
          <i class="fa-solid fa-trash"></i>ローカルから削除
        </button>
      `;
      optionsMenuEl.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      optionsMenuEl.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      document.body.appendChild(optionsMenuEl);

      const playlistSavePanelEl = document.createElement("div");
      playlistSavePanelEl.className = "playlist-save-panel hidden";
      playlistSavePanelEl.innerHTML = `
        <div class="playlist-save-title">保存先...</div>
        <div class="playlist-save-list" id="playlist-save-list"></div>
        <button type="button" class="playlist-save-create" id="playlist-save-create-btn">
          ＋ 新しい再生リスト
        </button>
      `;
      document.body.appendChild(playlistSavePanelEl);
      const playlistSaveListEl = playlistSavePanelEl.querySelector("#playlist-save-list");
      const playlistSaveCreateBtnEl = playlistSavePanelEl.querySelector("#playlist-save-create-btn");

      const playlistModalBackdropEl = document.createElement("div");
      playlistModalBackdropEl.className = "playlist-modal-backdrop hidden";
      playlistModalBackdropEl.innerHTML = `
        <div class="playlist-modal">
          <h3 class="playlist-modal-title">新しい再生リスト</h3>
          <input id="playlist-modal-input"
            class="playlist-modal-input"
            type="text"
            placeholder="タイトルを入力してください" />
          <div class="playlist-modal-actions">
            <button type="button" class="playlist-modal-btn" id="playlist-modal-cancel">キャンセル</button>
            <button type="button" class="playlist-modal-btn" id="playlist-modal-create">作成</button>
          </div>
        </div>
      `;
      document.body.appendChild(playlistModalBackdropEl);
      const playlistModalInputEl = playlistModalBackdropEl.querySelector("#playlist-modal-input");
      const playlistModalCancelEl = playlistModalBackdropEl.querySelector("#playlist-modal-cancel");
      const playlistModalCreateEl = playlistModalBackdropEl.querySelector("#playlist-modal-create");

      function getPlaylistById(playlistId) {
        return playlistsState.playlists.find((p) => p.id === playlistId) || null;
      }

      function getSelectedPlaylist() {
        return getPlaylistById(playlistsState.selectedId);
      }

      function updatePlaylistsState(nextState) {
        playlistsState = normalizePlaylistsState(nextState);
        savePlaylistsState(playlistsState).catch(() => {});
        renderPlaylistUi();
        renderPlaybackPlaylistSidebar();
      }

      function upsertPlaylist(name) {
        const trimmedName = String(name || "").trim();
        if (!trimmedName) return null;
        const existing = playlistsState.playlists.find((playlist) => playlist.name === trimmedName);
        if (existing) return existing;
        const newPlaylist = {
          id: createPlaylistId(),
          name: trimmedName,
          items: [],
        };
        updatePlaylistsState({
          playlists: [...playlistsState.playlists, newPlaylist],
          selectedId: newPlaylist.id,
        });
        return newPlaylist;
      }

      function addVideoToPlaylistById(video, playlistId) {
        if (!video?.filename || !playlistId) return;
        const target = getPlaylistById(playlistId);
        if (!target) return;
        if (target.items.includes(video.filename)) return;
        updatePlaylistsState({
          ...playlistsState,
          playlists: playlistsState.playlists.map((playlist) =>
            playlist.id === playlistId
              ? { ...playlist, items: [...playlist.items, video.filename] }
              : playlist,
          ),
          selectedId: playlistsState.selectedId || playlistId,
        });
      }

      function addVideoToSelectedPlaylist(video) {
        const selected = getSelectedPlaylist();
        if (!selected) return;
        addVideoToPlaylistById(video, selected.id);
      }

      function addVideoToWatchLater(video) {
        addVideoToPlaylistById(video, WATCH_LATER_PLAYLIST_ID);
      }

      function removeVideoFromSelectedPlaylist(filename) {
        const selected = getSelectedPlaylist();
        if (!selected) return;
        updatePlaylistsState({
          ...playlistsState,
          playlists: playlistsState.playlists.map((playlist) =>
            playlist.id === selected.id
              ? {
                ...playlist,
                items: playlist.items.filter((itemName) => itemName !== filename),
              }
              : playlist,
          ),
        });
      }

      function renderPlaylistUi() {
        if (!playlistSelectEl || !playlistItemsEl) return;
        const currentSelectedId = playlistsState.selectedId;
        playlistSelectEl.innerHTML = "";

        if (playlistsState.playlists.length === 0) {
          const emptyOption = document.createElement("option");
          emptyOption.value = "";
          emptyOption.textContent = "プレイリストなし";
          playlistSelectEl.appendChild(emptyOption);
          playlistSelectEl.disabled = true;
          if (playlistDeleteBtnEl) playlistDeleteBtnEl.disabled = true;
          if (playlistAddCurrentBtnEl) playlistAddCurrentBtnEl.disabled = true;
          playlistItemsEl.innerHTML = '<div class="status-subtext">プレイリストがありません</div>';
          return;
        }

        playlistsState.playlists.forEach((playlist) => {
          const option = document.createElement("option");
          option.value = playlist.id;
          option.textContent = playlist.name;
          playlistSelectEl.appendChild(option);
        });
        playlistSelectEl.disabled = false;
        if (playlistDeleteBtnEl) playlistDeleteBtnEl.disabled = false;
        if (playlistAddCurrentBtnEl) playlistAddCurrentBtnEl.disabled = false;
        playlistSelectEl.value = currentSelectedId || playlistsState.playlists[0].id;

        const selected = getSelectedPlaylist();
        const items = Array.isArray(selected?.items) ? selected.items : [];
        if (items.length === 0) {
          playlistItemsEl.innerHTML = '<div class="status-subtext">動画がありません</div>';
          return;
        }

        const videoMap = new Map(allLocalVideos.map((video) => [video.filename, video]));
        playlistItemsEl.innerHTML = "";
        items.forEach((filename) => {
          const video = videoMap.get(filename);
          if (!video) return;

          const row = document.createElement("div");
          row.className = "playlist-item";

          const title = document.createElement("div");
          title.className = "playlist-item-title";
          title.textContent = video.title || video.filename;
          title.title = video.filename;
          title.addEventListener("click", () => {
            const matchedItem = findLocalVideoListItem(videoList, video.filename);
            playLocalVideo(video, matchedItem || null, true);
          });

          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "playlist-item-remove";
          removeBtn.textContent = "削除";
          removeBtn.addEventListener("click", () => {
            removeVideoFromSelectedPlaylist(filename);
          });

          row.appendChild(title);
          row.appendChild(removeBtn);
          playlistItemsEl.appendChild(row);
        });

        if (!playlistItemsEl.hasChildNodes()) {
          playlistItemsEl.innerHTML = '<div class="status-subtext">動画がありません</div>';
        }
      }

      function hideOptionsMenu() {
        optionMenuVideo = null;
        optionsMenuEl.classList.add("hidden");
      }

      function hidePlaylistSavePanel() {
        playlistSaveTargetVideo = null;
        playlistSavePanelEl.classList.add("hidden");
      }

      function openPlaylistCreateModal(video) {
        playlistModalTargetVideo = video || optionMenuVideo || null;
        if (!playlistModalInputEl) return;
        playlistModalInputEl.value = "";
        playlistModalBackdropEl.classList.remove("hidden");
        playlistModalInputEl.focus();
      }

      function closePlaylistCreateModal() {
        playlistModalBackdropEl.classList.add("hidden");
      }

      function renderPlaylistSavePanel(video) {
        if (!playlistSaveListEl) return;
        const baseVideo = video || playlistSaveTargetVideo || optionMenuVideo;
        if (!baseVideo) return;

        playlistSaveListEl.innerHTML = "";
        const allPlaylists = playlistsState.playlists;
        if (allPlaylists.length === 0) {
          playlistSaveListEl.innerHTML = '<div class="status-subtext">保存先がありません</div>';
          return;
        }

        allPlaylists.forEach((playlist) => {
          const row = document.createElement("div");
          row.className = "playlist-save-row";

          const thumb = document.createElement("img");
          thumb.className = "playlist-save-thumb";
          thumb.src = baseVideo.thumb || "/none_icon.jpg";
          thumb.alt = playlist.name;
          thumb.onerror = () => {
            thumb.src = "/none_icon.jpg";
          };

          const textWrap = document.createElement("div");
          const nameEl = document.createElement("div");
          nameEl.className = "playlist-save-name";
          nameEl.textContent = playlist.name;
          const subEl = document.createElement("div");
          subEl.className = "playlist-save-sub";
          subEl.textContent = "非公開";
          textWrap.appendChild(nameEl);
          textWrap.appendChild(subEl);

          const actionBtn = document.createElement("button");
          actionBtn.type = "button";
          actionBtn.className = "playlist-save-action";
          actionBtn.innerHTML = '<i class="fa-regular fa-bookmark"></i>';
          actionBtn.addEventListener("click", () => {
            addVideoToPlaylistById(baseVideo, playlist.id);
          });

          row.appendChild(thumb);
          row.appendChild(textWrap);
          row.appendChild(actionBtn);
          playlistSaveListEl.appendChild(row);
        });
      }

      function openPlaylistSavePanel(anchorRect, video) {
        playlistSaveTargetVideo = video || null;
        renderPlaylistSavePanel(video);
        const panelWidth = Math.min(420, window.innerWidth - 24);
        const left = anchorRect
          ? Math.max(12, Math.min(window.innerWidth - panelWidth - 12, anchorRect.left))
          : 12;
        const top = anchorRect
          ? Math.min(window.innerHeight - 20, anchorRect.bottom + 8)
          : 60;
        playlistSavePanelEl.style.left = `${left}px`;
        playlistSavePanelEl.style.top = `${top}px`;
        playlistSavePanelEl.classList.remove("hidden");
      }

      async function copyVideoShareUrl(video) {
        const videoId = getPreferredVideoId(video);
        if (!videoId) return;
        let url = `http://localhost:3000/#player/${encodeURIComponent(videoId)}`;
        try {
          const response = await fetch(`/info/${encodeURIComponent(videoId)}`);
          if (response.ok) {
            const info = await response.json();
            if (info?.id) {
              url = `https://www.youtube.com/watch?v=${info.id}`;
            } else if (info?.webpage_url) {
              url = String(info.webpage_url);
            }
          }
        } catch (_error) {
          // fallback to local URL
        }
        await copyTextToClipboard(url);
      }

      function enqueueVideo(video) {
        if (!video?.filename) return;
        transientQueue.push(video.filename);
        renderPlaybackPlaylistSidebar();
      }

      function playNextVideoInQueue() {
        while (transientQueue.length > 0) {
          const nextFilename = transientQueue.shift();
          const nextVideo = allLocalVideos.find((video) => video.filename === nextFilename);
          if (!nextVideo) continue;
          const matchedItem = findLocalVideoListItem(videoList, nextVideo.filename);
          playLocalVideo(nextVideo, matchedItem || null, true);
          renderPlaybackPlaylistSidebar();
          return;
        }
        renderPlaybackPlaylistSidebar();
      }

      function removeVideoFromTransientQueue(filename) {
        if (!filename) return;
        for (let index = transientQueue.length - 1; index >= 0; index -= 1) {
          if (transientQueue[index] === filename) {
            transientQueue.splice(index, 1);
          }
        }
      }

      function removeVideoFromAllPlaylists(filename) {
        if (!filename) return;
        updatePlaylistsState({
          ...playlistsState,
          playlists: playlistsState.playlists.map((playlist) => ({
            ...playlist,
            items: Array.isArray(playlist.items)
              ? playlist.items.filter((itemName) => itemName !== filename)
              : [],
          })),
        });
      }

      function releaseCurrentVideoIfNeeded(video) {
        if (!video?.filename) return false;
        if (String(appState.lastSelectedFilename || "") !== String(video.filename)) {
          return false;
        }
        try {
          videoPlayer.pause();
          videoPlayer.removeAttribute("src");
          videoPlayer.poster = "";
          videoPlayer.load();
        } catch (_error) {
          // noop
        }
        appState.lastSelectedFilename = "";
        if (titleEl) {
          titleEl.textContent = "";
        }
        if (window.location.hash.startsWith("#player/")) {
          window.location.hash = "#home";
        }
        return true;
      }

      async function deleteLocalVideo(video) {
        if (!video?.videoPath) {
          throw new Error("削除対象のパス情報が見つかりません。");
        }

        const accepted = await showConfirm("本当に削除しますか？", {
          confirmText: "削除",
          cancelText: "キャンセル",
        });
        if (!accepted) return;

        releaseCurrentVideoIfNeeded(video);

        const response = await fetch("/api/local-video/delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            videoPath: video.videoPath,
          }),
        });
        const result = await parseApiResponse(response);
        if (!result.ok) {
          throw new Error(result.error || "ローカル動画の削除に失敗しました。");
        }

        removeVideoFromTransientQueue(video.filename);
        removeVideoFromAllPlaylists(video.filename);
        await loadLocalVideos(true);
        const movedCount = Number(result.data?.deletedCount || 0);
        showSuccess(
          movedCount > 0
            ? `ごみ箱へ移動しました。(${movedCount}件)`
            : "ごみ箱へ移動しました。",
        );
      }

      function createPlaybackSidebarItem(video, labelPrefix, onClick) {
        const row = document.createElement("div");
        row.className = "local-video-item";

        if (video?.thumb) {
          const thumb = document.createElement("img");
          thumb.className = "local-video-thumb";
          thumb.src = video.thumb;
          thumb.loading = "lazy";
          thumb.decoding = "async";
          thumb.onerror = () => {
            thumb.src = "/none_icon.jpg";
          };
          row.appendChild(thumb);
        } else {
          const thumbPlaceholder = document.createElement("div");
          thumbPlaceholder.className = "local-video-thumb";
          row.appendChild(thumbPlaceholder);
        }

        const text = document.createElement("div");
        text.className = "local-video-text";
        text.textContent = `${labelPrefix}${video?.title || video?.filename || "無題"}`;
        row.appendChild(text);

        if (typeof onClick === "function") {
          row.addEventListener("click", onClick);
        }
        return row;
      }

      function getQueuePlaybackEntries() {
        return transientQueue
          .map((filename, idx) => {
            const video = allLocalVideos.find((item) => item.filename === filename);
            if (!video) return null;
            return {
              key: `q:${filename}:${idx}`,
              video,
              labelPrefix: "[キュー] ",
              playlistMeta: null,
            };
          })
          .filter(Boolean);
      }

      function getPlaylistPlaybackEntries() {
        const listId = String(currentPlaylistPlayback.listId || "").trim();
        if (!listId) return [];
        const playlist = getPlaylistById(listId);
        if (!playlist || !Array.isArray(playlist.items) || playlist.items.length === 0) return [];

        const startIndexRaw = Number(currentPlaylistPlayback.index || 1);
        const startIndex = Number.isFinite(startIndexRaw) && startIndexRaw > 0
          ? startIndexRaw - 1
          : 0;
        const clampedStart = Math.max(0, Math.min(startIndex, playlist.items.length - 1));

        return playlist.items
          .slice(clampedStart)
          .map((filename, idx) => {
            const video = allLocalVideos.find((item) => item.filename === filename);
            if (!video) return null;
            const order = clampedStart + idx + 1;
            return {
              key: `p:${filename}:${order}`,
              video,
              labelPrefix: `[${order}] `,
              playlistMeta: {
                listId,
                index: String(order),
              },
            };
          })
          .filter(Boolean);
      }

      function renderPlaybackPlaylistSidebar() {
        if (!playbackPlaylistSectionEl || !playbackPlaylistItemsEl) return;
        const queueEntries = getQueuePlaybackEntries();
        const playlistEntries = getPlaylistPlaybackEntries();
        const entries = queueEntries.length > 0 ? queueEntries : playlistEntries;
        const currentPlaylist = getPlaylistById(String(currentPlaylistPlayback.listId || "").trim());

        if (entries.length === 0) {
          playbackPlaylistSectionEl.style.display = "none";
          playbackPlaylistItemsEl.innerHTML = "";
          if (playbackPlaylistTitleEl) {
            playbackPlaylistTitleEl.textContent = "プレイリスト";
          }
          return;
        }

        playbackPlaylistSectionEl.style.display = "";
        if (playbackPlaylistTitleEl) {
          if (queueEntries.length > 0) {
            playbackPlaylistTitleEl.textContent = "プレイリスト - キュー";
          } else {
            const playlistName = String(currentPlaylist?.name || "").trim() || "未設定";
            playbackPlaylistTitleEl.textContent = `プレイリスト - ${playlistName}`;
          }
        }
        playbackPlaylistItemsEl.innerHTML = "";

        const fragment = document.createDocumentFragment();
        entries.forEach((entry) => {
          fragment.appendChild(
            createPlaybackSidebarItem(
              entry.video,
              entry.labelPrefix,
              () => {
                const matchedItem = findLocalVideoListItem(videoList, entry.video.filename);
                playLocalVideo(entry.video, matchedItem || null, true, entry.playlistMeta);
              },
            ),
          );
        });
        playbackPlaylistItemsEl.appendChild(fragment);
      }

      function openOptionsMenu(video, anchorButton) {
        if (!video || !anchorButton) return;
        optionMenuVideo = video;
        const rect = anchorButton.getBoundingClientRect();
        const menuWidth = 250;
        const left = Math.max(8, Math.min(window.innerWidth - menuWidth - 8, rect.left - 8));
        const top = Math.min(window.innerHeight - 12, rect.bottom + 6);
        optionsMenuEl.style.left = `${left}px`;
        optionsMenuEl.style.top = `${top}px`;
        optionsMenuEl.classList.remove("hidden");
      }

      async function fetchLocalVideoInfoBatch(targetVideos) {
        const uncachedIds = [];
        targetVideos.forEach((video) => {
          const videoId = getPreferredVideoId(video);
          if (!videoId) return;
          if (localVideoInfoData.has(videoId) || requestedLocalVideoInfoIds.has(videoId)) {
            return;
          }
          uncachedIds.push(videoId);
        });
        if (uncachedIds.length === 0) return;

        const chunkSize = 20;
        const chunks = [];
        for (let i = 0; i < uncachedIds.length; i += chunkSize) {
          chunks.push(uncachedIds.slice(i, i + chunkSize));
        }
        uncachedIds.forEach((id) => requestedLocalVideoInfoIds.add(id));

        while (chunks.length > 0) {
          const chunk = chunks.shift();
          if (!chunk || chunk.length === 0) continue;
          try {
            const response = await fetch(`/api/home-info?ids=${encodeURIComponent(chunk.join(","))}`);
            const payload = response.ok ? await response.json() : null;
            const map = payload?.data || {};
            chunk.forEach((id) => {
              if (map[id]) {
                localVideoInfoData.set(id, map[id]);
              } else {
                requestedLocalVideoInfoIds.delete(id);
              }
            });
          } catch (_error) {
            chunk.forEach((id) => requestedLocalVideoInfoIds.delete(id));
          }
        }
      }

      function applyRenderedLocalVideoInfo(targetVideoIds = null) {
        const targetIdSet =
          Array.isArray(targetVideoIds) && targetVideoIds.length > 0
            ? new Set(targetVideoIds)
            : null;
        videoList.querySelectorAll(".local-video-item").forEach((item) => {
          const videoId = String(item.dataset.videoId || "").trim();
          if (!videoId) return;
          if (targetIdSet && !targetIdSet.has(videoId)) return;
          const info = localVideoInfoData.get(videoId);
          if (!info) return;
          const video = localVideoById.get(videoId);
          if (!video) return;
          applyLocalVideoListItemInfo(item, video, info);
        });
      }

      function scheduleLocalVideoInfoPrefetch(videos) {
        const idsToQueue = [];
        (Array.isArray(videos) ? videos : []).forEach((video) => {
          const videoId = getPreferredVideoId(video);
          if (!videoId) return;
          if (localVideoInfoData.has(videoId) || requestedLocalVideoInfoIds.has(videoId)) return;
          idsToQueue.push(videoId);
        });
        pendingLocalVideoInfoIds.push(...idsToQueue);
        if (localVideoInfoPrefetchPromise) return localVideoInfoPrefetchPromise;
        localVideoInfoPrefetchPromise = (async () => {
          while (pendingLocalVideoInfoIds.length > 0) {
            const pendingIds = Array.from(new Set(pendingLocalVideoInfoIds));
            pendingLocalVideoInfoIds = [];
            const pendingVideos = pendingIds
              .map((videoId) => localVideoById.get(videoId))
              .filter(Boolean);
            if (pendingVideos.length === 0) continue;
            await fetchLocalVideoInfoBatch(pendingVideos);
            applyRenderedLocalVideoInfo(pendingIds);
            await new Promise((resolve) => {
              if (typeof global.requestAnimationFrame === "function") {
                global.requestAnimationFrame(() => resolve());
                return;
              }
              setTimeout(resolve, 0);
            });
          }
        })().finally(() => {
          pendingLocalVideoInfoIds = [];
          localVideoInfoPrefetchPromise = null;
        });
        return localVideoInfoPrefetchPromise;
      }

      function initializePlaylistEvents() {
        if (playlistSelectEl) {
          playlistSelectEl.addEventListener("change", () => {
            updatePlaylistsState({
              ...playlistsState,
              selectedId: String(playlistSelectEl.value || ""),
            });
          });
        }

        playlistCreateBtnEl?.addEventListener("click", () => {
          const name = String(playlistNameInputEl?.value || "").trim();
          if (!name) return;
          const created = upsertPlaylist(name);
          if (created) {
            updatePlaylistsState({
              ...playlistsState,
              selectedId: created.id,
            });
          }
          if (playlistNameInputEl) playlistNameInputEl.value = "";
        });

        playlistDeleteBtnEl?.addEventListener("click", () => {
          const selected = getSelectedPlaylist();
          if (!selected) return;
          updatePlaylistsState({
            playlists: playlistsState.playlists.filter((p) => p.id !== selected.id),
            selectedId: "",
          });
        });

        playlistAddCurrentBtnEl?.addEventListener("click", () => {
          const filename = appState.lastSelectedFilename;
          if (!filename) return;
          const currentVideo = allLocalVideos.find((video) => video.filename === filename);
          if (!currentVideo) return;
          addVideoToSelectedPlaylist(currentVideo);
        });

        optionsMenuEl.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const button = event.target.closest(".local-video-options-item");
          if (!button) return;
          const action = button.getAttribute("data-action");
          const targetVideo = optionMenuVideo;
          hideOptionsMenu();
          if (!targetVideo) return;

          if (action === "queue") {
            enqueueVideo(targetVideo);
            return;
          }
          if (action === "watch-later") {
            addVideoToWatchLater(targetVideo);
            return;
          }
          if (action === "save-playlist") {
            openPlaylistSavePanel(optionsMenuEl.getBoundingClientRect(), targetVideo);
            return;
          }
          if (action === "share") {
            try {
              await copyVideoShareUrl(targetVideo);
            } catch (error) {
              onError("共有URLのコピーに失敗:", error);
            }
            return;
          }
          if (action === "delete-local") {
            try {
              await deleteLocalVideo(targetVideo);
            } catch (error) {
              onError("ローカル動画の削除に失敗:", error);
            }
          }
        });

        playlistSaveCreateBtnEl?.addEventListener("click", () => {
          openPlaylistCreateModal(playlistSaveTargetVideo || optionMenuVideo);
        });

        playlistModalCancelEl?.addEventListener("click", () => {
          closePlaylistCreateModal();
        });

        playlistModalCreateEl?.addEventListener("click", () => {
          const name = String(playlistModalInputEl?.value || "").trim();
          if (!name) return;
          const created = upsertPlaylist(name);
          if (created && playlistModalTargetVideo) {
            addVideoToPlaylistById(playlistModalTargetVideo, created.id);
          }
          closePlaylistCreateModal();
          renderPlaylistSavePanel(playlistModalTargetVideo);
          playlistModalTargetVideo = null;
        });

        document.addEventListener("click", (event) => {
          const target = event.target;
          const clickedOptionButton = target.closest(".local-video-option-btn");
          if (!clickedOptionButton && !optionsMenuEl.contains(target)) {
            hideOptionsMenu();
          }
          if (!playlistSavePanelEl.contains(target) && !optionsMenuEl.contains(target)) {
            hidePlaylistSavePanel();
          }
          if (target === playlistModalBackdropEl) {
            closePlaylistCreateModal();
          }
        });

        videoPlayer.addEventListener("ended", () => {
          playNextVideoInQueue();
        });

        renderPlaylistUi();
      }

      initializePlaylistEvents();
      fetchPlaylistsState()
        .then((serverState) => {
          playlistsState = normalizePlaylistsState(serverState);
          renderPlaylistUi();
          renderPlaybackPlaylistSidebar();
        })
        .catch(() => {});

      function scheduleHomeInfoPrefetch() {
        if (!onPrefetchHomeInfos) return;
        if (!document.getElementById("page-home")?.classList.contains("active-page")) {
          return;
        }
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(() => onPrefetchHomeInfos());
          return;
        }
        setTimeout(() => onPrefetchHomeInfos(), 0);
      }

      function playLocalVideo(video, activeItem = null, shouldAutoplay = true, playlistMeta = null) {
        const videoId = getPreferredVideoId(video);
        currentPlaylistPlayback = {
          listId: String(playlistMeta?.listId || "").trim(),
          index: String(playlistMeta?.index || "").trim(),
        };
        activateLocalVideoListItem(activeItem);
        setupLocalVideoPlayerSource(videoPlayer, titleEl, onResetSeekBar, video);
        tryAutoplayLocalVideo(videoPlayer, shouldAutoplay);
        navigateToPlayerPageFromVideoId(videoId, onAfterNavigate, playlistMeta);
        renderPlaybackPlaylistSidebar();
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

      function playPendingVideoIfAny(shouldAutoplay = false) {
        if (!appState.pendingVideoId) return false;
        const matchedVideo = findLocalVideoById(allLocalVideos, appState.pendingVideoId);
        if (!matchedVideo) return false;
        const matchedItem = findLocalVideoListItem(videoList, matchedVideo.filename);
        let hashListId = "";
        let hashIndex = "";
        try {
          const hash = String(window.location?.hash || "");
          const playerPrefix = "#player/";
          if (hash.startsWith(playerPrefix)) {
            const payload = hash.slice(playerPrefix.length);
            const [, ...tokens] = payload.split("&");
            tokens.forEach((token) => {
              const [rawKey, ...rawValueParts] = String(token || "").split("=");
              const key = decodeURIComponent(rawKey || "").trim();
              const value = decodeURIComponent(rawValueParts.join("=") || "").trim();
              if (key === "list") hashListId = value;
              if (key === "index") hashIndex = value;
            });
          }
        } catch (_error) {
          // noop
        }
        const playlistMeta =
          (appState.pendingPlaylistId || hashListId)
            ? {
              listId: appState.pendingPlaylistId || hashListId,
              index: appState.pendingPlaylistIndex || hashIndex || "",
            }
            : null;
        const resolvedAutoplay =
          typeof appState.pendingAutoplay === "boolean"
            ? appState.pendingAutoplay
            : shouldAutoplay;
        playLocalVideo(matchedVideo, matchedItem || null, resolvedAutoplay, playlistMeta);
        appState.pendingVideoId = null;
        appState.pendingPlaylistId = "";
        appState.pendingPlaylistIndex = "";
        appState.pendingAutoplay = undefined;
        return true;
      }

      function playVideoById(videoId, { shouldAutoplay = true, playlistMeta = null } = {}) {
        const targetId = String(videoId || "").trim();
        if (!targetId) return false;
        const matchedVideo = findLocalVideoById(allLocalVideos, targetId);
        if (!matchedVideo) return false;
        const matchedItem = findLocalVideoListItem(videoList, matchedVideo.filename);
        playLocalVideo(matchedVideo, matchedItem || null, shouldAutoplay, playlistMeta);
        return true;
      }

      function applyLocalVideos(videos) {
        allLocalVideos = Array.isArray(videos) ? videos : [];
        localVideoById.clear();
        allLocalVideos.forEach((video) => {
          const videoId =
            String(video.videoId || "").trim() || getVideoIdFromFilename(video.filename);
          if (videoId) {
            localVideoById.set(videoId, video);
            const inlineInfo = buildInlineHomeInfo(video);
            if (inlineInfo) {
              localVideoInfoData.set(videoId, {
                ...(localVideoInfoData.get(videoId) || {}),
                ...inlineInfo,
              });
            }
          }
        });
        renderLocalVideoList(
          videoList,
          allLocalVideos,
          playLocalVideo,
          openOptionsMenu,
          (chunkVideos) => void scheduleLocalVideoInfoPrefetch(chunkVideos),
        );
        onRenderHomeVideos?.(allLocalVideos);
        renderPlaylistUi();
        renderPlaybackPlaylistSidebar();
        scheduleHomeInfoPrefetch();
        playPendingVideoIfAny(false);
        window.dispatchEvent(
          new CustomEvent("app:local-videos-updated", {
            detail: { count: allLocalVideos.length },
          }),
        );
      }

      async function loadLocalVideos(forceRefresh = false) {
        const startedAt = performance.now();
        try {
          const url = forceRefresh ? "/api/local-videos?refresh=1" : "/api/local-videos";
          const res = await fetch(url);
          const result = await parseApiResponse(res);
          if (!result.ok) {
            throw new Error(result.error || "動画一覧の取得に失敗しました。");
          }
          const videos = result.data;
          applyLocalVideos(videos);
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
        playPendingVideoIfAny,
        playVideoById,
        openVideoOptionsForVideo: (video, anchorElement) => openOptionsMenu(video, anchorElement),
        loadLocalVideos,
        applyLocalVideos,
      };
    }

    return {
      createVideoDataController,
      createLocalVideoController,
    };
  }

  global.createLocalVideoModule = createLocalVideoModule;
})(window);
