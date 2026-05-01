(function attachPlaylistPageModule(global) {
  const PLAYLIST_HASH_PREFIX = "#playlists/";
  const CHANNEL_HASH_PREFIX = "#playlists/channel/";
  const SHORTS_MAX_DURATION_SEC = 60;
  const LIVE_STATUS_VALUES = new Set(["is_live", "was_live", "post_live"]);

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
    const sectionExpandedState = {
      playlists: false,
      channels: false,
    };
    let pageDataCache = null;
    let pageDataPromise = null;

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
      if (hash.startsWith(CHANNEL_HASH_PREFIX)) return "";
      return decodeURIComponent(hash.slice(PLAYLIST_HASH_PREFIX.length)).trim();
    }

    function getChannelRouteFromHash() {
      const hash = String(global.location?.hash || "");
      if (!hash.startsWith(CHANNEL_HASH_PREFIX)) {
        return { channelId: "", tab: "home" };
      }
      const payload = hash.slice(CHANNEL_HASH_PREFIX.length);
      const [rawChannelId, rawTab] = payload.split("/");
      const tab = String(rawTab || "home").trim().toLowerCase();
      return {
        channelId: decodeURIComponent(rawChannelId || "").trim(),
        tab: ["home", "videos", "shorts", "live"].includes(tab) ? tab : "home",
      };
    }

    function stripVideoExtension(filename) {
      return String(filename || "").replace(/\.(mp4|mkv|webm|mov)$/i, "");
    }

    function getPreferredVideoId(video) {
      const actualVideoId = String(video?.videoId || "").trim();
      if (actualVideoId) return actualVideoId;
      return stripVideoExtension(video?.filename);
    }

    function formatCountLabel(value, suffix) {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) return "";
      return `${num.toLocaleString()} ${suffix}`;
    }

    function formatSubscriberCount(value) {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) return "";
      return `登録者 ${num.toLocaleString()} 人`;
    }

    function formatVideoCount(value) {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) return "動画 0 本";
      return `動画 ${num.toLocaleString()} 本`;
    }

    async function loadLocalVideos() {
      const response = await fetch("/api/local-videos");
      const result = await parseApiResponse(response);
      if (!result.ok) {
        throw new Error(result.error || "ローカル動画一覧の取得に失敗しました。");
      }
      return Array.isArray(result.data) ? result.data : [];
    }

    async function loadLocalChannels() {
      try {
        const response = await fetch("/api/local-channels");
        const result = await parseApiResponse(response);
        if (!result.ok) return [];
        return Array.isArray(result.data) ? result.data : [];
      } catch (_error) {
        return [];
      }
    }

    function clonePageData(data) {
      if (!data || typeof data !== "object") return null;
      return data;
    }

    function buildEnrichedVideos(videos) {
      return (Array.isArray(videos) ? videos : []).map((video) => {
        const lookupId = getPreferredVideoId(video);
        const legacyId = stripVideoExtension(video?.filename);
        const channelId = String(video?.channelId || "").trim();
        const liveStatus = String(video?.liveStatus || "").trim().toLowerCase();
        return {
          ...video,
          id: lookupId || legacyId,
          videoId: lookupId || legacyId,
          lookupId,
          legacyId,
          info: null,
          channelId,
          channelName: String(video?.channelName || "").trim(),
          channelThumbnail: String(video?.channelThumbnail || "").trim(),
          liveStatus,
          isLive: video?.isLive === true,
          wasLive: video?.wasLive === true,
          duration: Number.isFinite(Number(video?.duration))
            ? Math.max(0, Math.round(Number(video.duration)))
            : null,
          webpageUrl: String(video?.webpageUrl || "").trim(),
        };
      });
    }

    function isLiveLikeVideo(video) {
      if (!video) return false;
      if (video.isLive === true || video.wasLive === true) return true;
      return LIVE_STATUS_VALUES.has(String(video.liveStatus || "").trim().toLowerCase());
    }

    function isShortVideo(video) {
      const duration = Number(video?.duration);
      if (!Number.isFinite(duration)) return false;
      if (duration <= 0) return false;
      if (isLiveLikeVideo(video)) return false;
      return duration <= SHORTS_MAX_DURATION_SEC;
    }

    function buildChannelMap(channels, videos) {
      const map = new Map();

      (Array.isArray(channels) ? channels : []).forEach((channel) => {
        const id = String(channel?.channelId || channel?.id || "").trim();
        if (!id) return;
        map.set(id, {
          id,
          channelId: id,
          name: String(channel?.name || "").trim() || "チャンネル",
          handle: String(channel?.handle || "").trim(),
          url: String(channel?.url || "").trim(),
          avatar: String(channel?.avatar || "").trim(),
          banner: String(channel?.banner || "").trim(),
          subscriberCount: Number.isFinite(Number(channel?.subscriberCount))
            ? Number(channel.subscriberCount)
            : null,
          videos: [],
        });
      });

      (Array.isArray(videos) ? videos : []).forEach((video) => {
        const channelId = String(video?.channelId || "").trim();
        const channelName = String(video?.channelName || "").trim();
        if (!channelId || !channelName) return;
        if (!map.has(channelId)) {
          map.set(channelId, {
            id: channelId,
            channelId,
            name: channelName,
            handle: "",
            url: "",
            avatar: String(video?.channelThumbnail || "").trim(),
            banner: "",
            subscriberCount: null,
            videos: [],
          });
        }
        const channel = map.get(channelId);
        if (!channel.avatar && video?.channelThumbnail) {
          channel.avatar = String(video.channelThumbnail || "").trim();
        }
        channel.videos.push(video);
      });

      const list = [...map.values()]
        .map((channel) => {
          channel.videos.sort((a, b) => Number(b?.mtime || 0) - Number(a?.mtime || 0));
          return channel;
        })
        .sort((a, b) => {
          const countDiff = Number(b.videos.length || 0) - Number(a.videos.length || 0);
          if (countDiff !== 0) return countDiff;
          return String(a.name || "").localeCompare(String(b.name || ""), "ja");
        });

      return list;
    }

    function buildLightweightChannelMap(channels) {
      return (Array.isArray(channels) ? channels : [])
        .map((channel) => {
          const id = String(channel?.channelId || channel?.id || "").trim();
          if (!id) return null;
          return {
            id,
            channelId: id,
            name: String(channel?.name || "").trim() || "チャンネル",
            handle: String(channel?.handle || "").trim(),
            url: String(channel?.url || "").trim(),
            avatar: String(channel?.avatar || "").trim(),
            banner: String(channel?.banner || "").trim(),
            subscriberCount: Number.isFinite(Number(channel?.subscriberCount))
              ? Number(channel.subscriberCount)
              : null,
            videos: [],
          };
        })
        .filter(Boolean)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ja"));
    }

    function formatChannelMeta(channel) {
      return (
        formatSubscriberCount(channel?.subscriberCount) ||
        (Array.isArray(channel?.videos) && channel.videos.length > 0
          ? formatVideoCount(channel.videos.length)
          : "")
      );
    }

    function formatVideoTypeLabel(video) {
      if (isLiveLikeVideo(video)) return "ライブ";
      if (isShortVideo(video)) return "ショート";
      return "動画";
    }

    function buildChannelTabs(channel) {
      const videos = Array.isArray(channel?.videos) ? channel.videos : [];
      const live = videos.filter((video) => isLiveLikeVideo(video));
      const shorts = videos.filter((video) => isShortVideo(video));
      const videosOnly = videos.filter((video) => !isLiveLikeVideo(video) && !isShortVideo(video));
      return {
        home: videos,
        videos: videosOnly,
        shorts,
        live,
      };
    }

    function createSectionHeader(title, sectionKey) {
      const header = document.createElement("div");
      header.className = "playlist-page-section-header";

      const titleEl = document.createElement("h2");
      titleEl.className = "playlist-page-section-title";
      titleEl.textContent = title;

      const actions = document.createElement("div");
      actions.className = "playlist-page-section-actions";

      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "playlist-page-expand-btn";
      toggleBtn.textContent = sectionExpandedState[sectionKey] ? "折りたたむ" : "展開";
      toggleBtn.addEventListener("click", () => {
        sectionExpandedState[sectionKey] = !sectionExpandedState[sectionKey];
        render();
      });

      actions.appendChild(toggleBtn);
      header.appendChild(titleEl);
      header.appendChild(actions);
      return header;
    }

    function createSectionContainer(sectionKey) {
      const wrapper = document.createElement("section");
      wrapper.className = "playlist-page-section";

      const content = document.createElement("div");
      const isExpanded = sectionExpandedState[sectionKey] === true;
      content.className = isExpanded
        ? "playlist-page-section-grid"
        : "playlist-page-horizontal-scroll";
      if (!isExpanded) {
        const track = document.createElement("div");
        track.className = "playlist-page-horizontal-track";
        content.appendChild(track);
      }

      wrapper.appendChild(content);
      return {
        wrapper,
        content,
        track: isExpanded ? content : content.firstChild,
      };
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

    function createChannelCard(channel, onOpen) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "playlist-page-channel-card";
      card.addEventListener("click", onOpen);

      const avatar = document.createElement("img");
      avatar.className = "playlist-page-channel-avatar";
      avatar.loading = "lazy";
      avatar.decoding = "async";
      avatar.src = channel?.avatar || "/none_icon.jpg";
      avatar.alt = channel?.name || "channel";
      avatar.onerror = () => {
        avatar.src = "/none_icon.jpg";
      };

      const name = document.createElement("div");
      name.className = "playlist-page-channel-name";
      name.textContent = channel?.name || "チャンネル";

      const meta = document.createElement("div");
      meta.className = "playlist-page-channel-meta";
      meta.textContent = formatChannelMeta(channel);

      card.appendChild(avatar);
      card.appendChild(name);
      card.appendChild(meta);
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
      const metaParts = [];
      if (video?.channelName) {
        metaParts.push(video.channelName);
      }
      metaParts.push(formatVideoTypeLabel(video));
      if (Number.isFinite(Number(video?.duration)) && Number(video.duration) > 0) {
        metaParts.push(`${Math.round(Number(video.duration))} 秒`);
      }
      meta.textContent = metaParts.join(" ・ ") || video?.filename || "";

      body.appendChild(title);
      body.appendChild(meta);
      row.appendChild(thumb);
      row.appendChild(body);
      return row;
    }

    function createChannelVideoCard(video, onOpen) {
      const card = document.createElement("article");
      card.className = "playlist-page-channel-video-card";
      card.addEventListener("click", onOpen);

      const thumb = document.createElement("img");
      thumb.className = "playlist-page-channel-video-thumb";
      thumb.loading = "lazy";
      thumb.decoding = "async";
      thumb.src = video?.thumb || "/none_icon.jpg";
      thumb.alt = video?.title || video?.filename || "video";
      thumb.onerror = () => {
        thumb.src = "/none_icon.jpg";
      };

      const body = document.createElement("div");
      body.className = "playlist-page-channel-video-body";

      const title = document.createElement("div");
      title.className = "playlist-page-channel-video-title";
      title.textContent = video?.title || video?.filename || "無題";

      const meta = document.createElement("div");
      meta.className = "playlist-page-channel-video-meta";
      const metaParts = [];
      if (video?.channelName) {
        metaParts.push(video.channelName);
      }
      metaParts.push(formatVideoTypeLabel(video));
      if (Number.isFinite(Number(video?.duration)) && Number(video.duration) > 0) {
        metaParts.push(`${Math.round(Number(video.duration))} 秒`);
      }
      meta.textContent = metaParts.join(" ・ ");

      body.appendChild(title);
      body.appendChild(meta);
      card.appendChild(thumb);
      card.appendChild(body);
      return card;
    }

    function openPlaylistDetail(playlistId) {
      if (!playlistId) return;
      history.pushState(null, "", `#playlists/${encodeURIComponent(playlistId)}`);
      render();
    }

    function openChannelDetail(channelId, tab = "home") {
      if (!channelId) return;
      const suffix = tab && tab !== "home" ? `/${encodeURIComponent(tab)}` : "";
      history.pushState(
        null,
        "",
        `#playlists/channel/${encodeURIComponent(channelId)}${suffix}`,
      );
      render();
    }

    function createBackButton(onBack, text = "一覧へ戻る") {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "playlist-page-back-btn";
      button.innerHTML = `<i class="fa-solid fa-chevron-left"></i> ${text}`;
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

    function createChannelSummaryCard(channel) {
      const card = document.createElement("section");
      card.className = "playlist-page-channel-hero";

      if (channel?.banner) {
        const banner = document.createElement("div");
        banner.className = "playlist-page-channel-banner-wrap";
        const bannerImg = document.createElement("img");
        bannerImg.className = "playlist-page-channel-banner";
        bannerImg.loading = "lazy";
        bannerImg.decoding = "async";
        bannerImg.src = channel.banner;
        bannerImg.alt = channel.name || "channel banner";
        bannerImg.onerror = () => {
          banner.remove();
        };
        banner.appendChild(bannerImg);
        card.appendChild(banner);
      }

      const body = document.createElement("div");
      body.className = "playlist-page-channel-hero-body";

      const avatar = document.createElement("img");
      avatar.className = "playlist-page-channel-hero-avatar";
      avatar.loading = "lazy";
      avatar.decoding = "async";
      avatar.src = channel?.avatar || "/none_icon.jpg";
      avatar.alt = channel?.name || "channel";
      avatar.onerror = () => {
        avatar.src = "/none_icon.jpg";
      };

      const text = document.createElement("div");
      text.className = "playlist-page-channel-hero-text";

      const title = document.createElement("h2");
      title.className = "playlist-page-channel-hero-title";
      title.textContent = channel?.name || "チャンネル";

      const meta = document.createElement("div");
      meta.className = "playlist-page-channel-hero-meta";
      const metaParts = [
        String(channel?.handle || "").trim(),
        formatSubscriberCount(channel?.subscriberCount),
        Array.isArray(channel?.videos) && channel.videos.length > 0
          ? formatVideoCount(channel.videos.length)
          : "",
      ].filter(Boolean);
      meta.textContent = metaParts.join(" ・ ");

      text.appendChild(title);
      text.appendChild(meta);
      body.appendChild(avatar);
      body.appendChild(text);
      card.appendChild(body);
      return card;
    }

    function createChannelTabBar(channel, activeTab) {
      const tabs = buildChannelTabs(channel);
      const tabBar = document.createElement("div");
      tabBar.className = "playlist-page-channel-tabs";
      [
        { key: "home", label: "ホーム" },
        { key: "videos", label: "動画" },
        { key: "shorts", label: "ショート" },
        { key: "live", label: "ライブ" },
      ].forEach((tab) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "playlist-page-channel-tab-btn";
        if (tab.key === activeTab) {
          button.classList.add("active");
        }
        const count = Array.isArray(tabs[tab.key]) ? tabs[tab.key].length : 0;
        button.textContent = count > 0 ? `${tab.label} (${count})` : tab.label;
        button.addEventListener("click", () => openChannelDetail(channel.id, tab.key));
        tabBar.appendChild(button);
      });
      return tabBar;
    }

    function openFirstVideo(firstVideo, playlistId = "", playlistIndex = null) {
      if (!firstVideo?.filename) return;
      const videoId = getPreferredVideoId(firstVideo);
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

    function renderPlaylistDetail(state, videoMap) {
      const selectedPlaylistId = getPlaylistIdFromHash();
      const selectedPlaylist = state.playlists.find((playlist) => playlist.id === selectedPlaylistId);
      if (!selectedPlaylist) {
        renderEmpty("指定されたプレイリストが見つかりません");
        return true;
      }

      const playableVideos = selectedPlaylist.items
        .map((filename) => videoMap.get(filename))
        .filter(Boolean);
      if (playableVideos.length === 0) {
        const backButton = createBackButton(() => {
          history.pushState(null, "", "#playlists");
          render();
        }, "プレイリスト一覧へ戻る");
        grid.appendChild(backButton);
        const empty = document.createElement("div");
        empty.className = "home-video-empty";
        empty.textContent = "プレイリストに再生可能な動画がありません";
        grid.appendChild(empty);
        return true;
      }

      const backButton = createBackButton(() => {
        history.pushState(null, "", "#playlists");
        render();
      }, "プレイリスト一覧へ戻る");
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
      return true;
    }

    function renderChannelDetail(channel, route) {
      if (!route?.channelId) return false;
      if (!channel) {
        renderEmpty("指定されたチャンネルが見つかりません");
        return true;
      }

      const tabs = buildChannelTabs(channel);
      const activeTabVideos = Array.isArray(tabs[route.tab]) ? tabs[route.tab] : tabs.home;

      const detail = document.createElement("div");
      detail.className = "playlist-page-channel-detail";

      detail.appendChild(
        createBackButton(() => {
          history.pushState(null, "", "#playlists");
          render();
        }, "一覧へ戻る"),
      );
      detail.appendChild(createChannelSummaryCard(channel));
      detail.appendChild(createChannelTabBar(channel, route.tab));

      const content = document.createElement("div");
      content.className = "playlist-page-channel-video-grid";
      if (activeTabVideos.length === 0) {
        const empty = document.createElement("div");
        empty.className = "home-video-empty";
        empty.textContent = "このタブに表示できる動画はありません";
        content.appendChild(empty);
      } else {
        activeTabVideos.forEach((video) => {
          content.appendChild(
            createChannelVideoCard(video, () => openFirstVideo(video)),
          );
        });
      }

      detail.appendChild(content);
      grid.appendChild(detail);
      return true;
    }

    function renderTopSections(state, videos, channels) {
      const videoMap = new Map(videos.map((video) => [video.filename, video]));
      const playlistSection = createSectionContainer("playlists");
      playlistSection.wrapper.appendChild(createSectionHeader("プレイリスト", "playlists"));
      playlistSection.wrapper.insertBefore(
        playlistSection.wrapper.lastChild,
        playlistSection.wrapper.firstChild,
      );
      const playlistTrack = playlistSection.track;
      let renderedPlaylistCount = 0;
      state.playlists.forEach((playlist) => {
        const playableVideos = playlist.items
          .map((filename) => videoMap.get(filename))
          .filter(Boolean);
        if (playableVideos.length === 0) return;
        playlistTrack.appendChild(
          createCardElement(
            playlist,
            playableVideos[0],
            playableVideos.length,
            () => openPlaylistDetail(playlist.id),
          ),
        );
        renderedPlaylistCount += 1;
      });
      if (renderedPlaylistCount === 0) {
        const empty = document.createElement("div");
        empty.className = "home-video-empty";
        empty.textContent = "再生可能な動画があるプレイリストはありません";
        playlistTrack.appendChild(empty);
      }

      const channelSection = createSectionContainer("channels");
      channelSection.wrapper.appendChild(createSectionHeader("チャンネル", "channels"));
      channelSection.wrapper.insertBefore(
        channelSection.wrapper.lastChild,
        channelSection.wrapper.firstChild,
      );
      const channelTrack = channelSection.track;
      if (channels.length === 0) {
        const empty = document.createElement("div");
        empty.className = "home-video-empty";
        empty.textContent = "チャンネル情報がありません";
        channelTrack.appendChild(empty);
      } else {
        channels.forEach((channel) => {
          channelTrack.appendChild(
            createChannelCard(channel, () => openChannelDetail(channel.id)),
          );
        });
      }

      grid.appendChild(playlistSection.wrapper);
      grid.appendChild(channelSection.wrapper);
    }

    async function ensurePageData(forceRefresh = false) {
      if (!forceRefresh && pageDataCache) {
        return clonePageData(pageDataCache);
      }
      if (!forceRefresh && pageDataPromise) {
        return pageDataPromise;
      }

      const loadPromise = (async () => {
        const [state, localVideos, localChannels] = await Promise.all([
          loadPlaylistsState(parseApiResponse),
          loadLocalVideos(),
          loadLocalChannels(),
        ]);
        const videos = buildEnrichedVideos(localVideos);
        const videoMap = new Map(videos.map((video) => [video.filename, video]));
        const channels = buildLightweightChannelMap(localChannels);
        const payload = {
          state,
          localVideos,
          localChannels,
          videos,
          videoMap,
          channels,
        };
        pageDataCache = payload;
        return clonePageData(payload);
      })();

      pageDataPromise = loadPromise;
      try {
        return await loadPromise;
      } finally {
        if (pageDataPromise === loadPromise) {
          pageDataPromise = null;
        }
      }
    }

    function invalidatePageData() {
      pageDataCache = null;
      pageDataPromise = null;
    }

    function getChannelDetailFromPageData(pageData, channelId) {
      const fallbackChannel =
        (Array.isArray(pageData?.channels)
          ? pageData.channels.find((item) => item.id === channelId)
          : null) || null;
      const videos = buildEnrichedVideos(pageData?.localVideos || []);
      const channels = buildChannelMap(pageData?.localChannels || [], videos);
      return channels.find((item) => item.id === channelId) || fallbackChannel;
    }

    async function render() {
      if (!grid || !isPlaylistPageActive()) return;

      try {
        const route = getChannelRouteFromHash();
        const {
          state,
          videos,
          videoMap,
          channels,
          localVideos,
          localChannels,
        } = await ensurePageData();

        grid.innerHTML = "";

        if (route.channelId) {
          const channel = getChannelDetailFromPageData(
            { channels, localVideos, localChannels },
            route.channelId,
          );
          if (renderChannelDetail(channel, route)) {
            return;
          }
        }

        if (getPlaylistIdFromHash()) {
          renderPlaylistDetail(state, videoMap);
          return;
        }

        renderTopSections(state, videos, channels);
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
      global.addEventListener("app:local-videos-updated", () => {
        invalidatePageData();
        if (isPlaylistPageActive()) {
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
      invalidatePageData,
      initialize,
      render,
    };
  }

  global.createPlaylistPageController = createPlaylistPageController;
})(window);
