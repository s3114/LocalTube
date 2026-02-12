(function attachHomeVideoBrowser(global) {
  function getHomeFilterStateFromInputs({
    filterChannel,
    filterDateFromText,
    filterDateFrom,
    filterDateToText,
    filterDateTo,
    filterDurationRange,
    filterDurationMin,
    filterDurationMax,
  }) {
    return {
      channelKeyword: String(filterChannel?.value || "")
        .trim()
        .toLowerCase(),
      fromYmd: normalizeYyyymmdd(filterDateFromText?.value || filterDateFrom?.value),
      toYmd: normalizeYyyymmdd(filterDateToText?.value || filterDateTo?.value),
      durationMode: String(filterDurationRange?.value || "all"),
      durationMinSec: parseDurationInput(filterDurationMin?.value),
      durationMaxSec: parseDurationInput(filterDurationMax?.value),
    };
  }

  function getHomeSearchStateForUrlFromInputs({
    homeSearchInput,
    filterChannel,
    filterDateFromText,
    filterDateFrom,
    filterDateToText,
    filterDateTo,
    filterDurationRange,
    filterDurationMin,
    filterDurationMax,
  }) {
    return {
      q: String(homeSearchInput?.value || "").trim(),
      ch: String(filterChannel?.value || "").trim(),
      df: normalizeYyyymmdd(filterDateFromText?.value || filterDateFrom?.value),
      dt: normalizeYyyymmdd(filterDateToText?.value || filterDateTo?.value),
      dr: String(filterDurationRange?.value || "all"),
      dmin: String(filterDurationMin?.value || "").trim(),
      dmax: String(filterDurationMax?.value || "").trim(),
    };
  }

  function applyHomeSearchStateFromUrlToInputs({
    homeSearchInput,
    filterChannel,
    filterDateFromText,
    filterDateFrom,
    filterDateToText,
    filterDateTo,
    filterDurationRange,
    filterDurationMin,
    filterDurationMax,
  }) {
    const params = new URLSearchParams(location.search);
    const safeDurationModes = new Set(["all", "lt3", "3to20", "ge20", "custom"]);

    if (homeSearchInput) homeSearchInput.value = params.get("q") || "";
    if (filterChannel) filterChannel.value = params.get("ch") || "";

    const fromYmd = normalizeYyyymmdd(params.get("df") || "");
    const toYmd = normalizeYyyymmdd(params.get("dt") || "");
    if (filterDateFromText) filterDateFromText.value = fromYmd;
    if (filterDateToText) filterDateToText.value = toYmd;
    if (filterDateFrom) filterDateFrom.value = yyyymmddToDateInput(fromYmd);
    if (filterDateTo) filterDateTo.value = yyyymmddToDateInput(toYmd);

    const durationMode = params.get("dr") || "all";
    if (filterDurationRange) {
      filterDurationRange.value = safeDurationModes.has(durationMode)
        ? durationMode
        : "all";
    }
    if (filterDurationMin) filterDurationMin.value = params.get("dmin") || "";
    if (filterDurationMax) filterDurationMax.value = params.get("dmax") || "";
  }

  function syncHomeSearchStateToUrlFromInputs(inputs) {
    const params = new URLSearchParams(location.search);
    const state = getHomeSearchStateForUrlFromInputs(inputs);

    const assignOrDelete = (key, value) => {
      if (value) params.set(key, value);
      else params.delete(key);
    };

    assignOrDelete("q", state.q);
    assignOrDelete("ch", state.ch);
    assignOrDelete("df", state.df);
    assignOrDelete("dt", state.dt);
    assignOrDelete("dr", state.dr !== "all" ? state.dr : "");
    assignOrDelete("dmin", state.dmin);
    assignOrDelete("dmax", state.dmax);

    const search = params.toString();
    const nextUrl = `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
    history.replaceState(null, "", nextUrl);
  }

  function setDurationCustomInputState(
    filterDurationRange,
    filterDurationMin,
    filterDurationMax,
  ) {
    const isCustom = String(filterDurationRange?.value || "all") === "custom";
    if (filterDurationMin) filterDurationMin.disabled = !isCustom;
    if (filterDurationMax) filterDurationMax.disabled = !isCustom;
  }

  function clearHomeFiltersInputs({
    filterDateFrom,
    filterDateFromText,
    filterDateTo,
    filterDateToText,
    filterDurationRange,
    filterDurationMin,
    filterDurationMax,
    filterChannel,
  }) {
    if (filterDateFrom) filterDateFrom.value = "";
    if (filterDateFromText) filterDateFromText.value = "";
    if (filterDateTo) filterDateTo.value = "";
    if (filterDateToText) filterDateToText.value = "";
    if (filterDurationRange) filterDurationRange.value = "all";
    if (filterDurationMin) filterDurationMin.value = "";
    if (filterDurationMax) filterDurationMax.value = "";
    if (filterChannel) filterChannel.value = "";
  }

  function bindHomeDatePair(dateEl, textEl, onChanged) {
    if (!dateEl || !textEl) return;

    dateEl.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (typeof dateEl.showPicker === "function") dateEl.showPicker();
      else dateEl.focus();
    });
    dateEl.addEventListener("keydown", (e) => e.preventDefault());

    dateEl.addEventListener("change", () => {
      textEl.value = dateInputToYyyymmdd(dateEl.value);
      onChanged?.();
    });
    textEl.addEventListener("input", () => {
      const ymd = normalizeYyyymmdd(textEl.value);
      if (ymd.length === 8) dateEl.value = yyyymmddToDateInput(ymd);
      onChanged?.();
    });
  }

  function buildDateVariants(yyyymmdd) {
    const value = String(yyyymmdd || "").replace(/\D/g, "");
    if (value.length !== 8) return [];
    return [
      value,
      `${value.slice(0, 4)}/${value.slice(4, 6)}/${value.slice(6, 8)}`,
      `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`,
      `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`,
    ];
  }

  function buildDurationVariants(durationSec) {
    const sec = Number(durationSec);
    if (!Number.isFinite(sec) || sec < 0) return [];
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mOnly = h * 60 + m;
    const mmss = `${String(mOnly).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    const hms = `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    const ms = `${m}:${String(s).padStart(2, "0")}`;
    const jp = h > 0 ? `${h}時間${m}分${s}秒` : `${m}分${s}秒`;
    return [String(total), ms, mmss, hms, jp, `${mOnly}分`];
  }

  function formatHomeUploadDateText(uploadDate) {
    const d = String(uploadDate || "").replace(/\D/g, "");
    if (d.length !== 8) return "投稿日不明";
    return `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
  }

  function formatHomeViewCountText(viewCount) {
    if (typeof viewCount === "number" && Number.isFinite(viewCount)) {
      return `${viewCount.toLocaleString()} 回視聴`;
    }
    return "視聴回数不明";
  }

  function buildHomeSearchSourceFromVideo(video, info) {
    const parts = [];
    parts.push(String(video.title || ""));
    parts.push(String(video.filename || ""));
    const mtimeDate = new Date(Number(video.mtime || 0));
    if (!isNaN(mtimeDate.getTime())) {
      const y = mtimeDate.getFullYear();
      const m = String(mtimeDate.getMonth() + 1).padStart(2, "0");
      const d = String(mtimeDate.getDate()).padStart(2, "0");
      parts.push(`${y}${m}${d}`);
      parts.push(`${y}/${m}/${d}`);
      parts.push(`${y}-${m}-${d}`);
      parts.push(`${y}年${m}月${d}日`);
    }
    if (info) {
      parts.push(String(info.title || ""));
      parts.push(String(info.channel || ""));
      parts.push(String(info.uploader || ""));
      buildDateVariants(info.upload_date).forEach((v) => parts.push(v));
      buildDurationVariants(info.duration).forEach((v) => parts.push(v));
    }
    return parts.join(" ").toLowerCase();
  }

  function getHomeVideoUploadDateYmd(video, info) {
    const fromInfo = normalizeYyyymmdd(info?.upload_date);
    if (fromInfo) return fromInfo;
    const dt = new Date(Number(video.mtime || 0));
    if (isNaN(dt.getTime())) return "";
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}${m}${d}`;
  }

  function matchesHomeChannelFilter(info, channelKeyword) {
    if (!channelKeyword) return true;
    const channelSource = `${info?.channel || ""} ${info?.uploader || ""}`.toLowerCase();
    return channelSource.includes(channelKeyword);
  }

  function matchesHomeDateFilter(video, info, fromYmd, toYmd) {
    if (!fromYmd && !toYmd) return true;
    const uploadYmd = getHomeVideoUploadDateYmd(video, info);
    if (!uploadYmd) return false;
    const uploadNum = Number(uploadYmd);
    if (fromYmd && uploadNum < Number(fromYmd)) return false;
    if (toYmd && uploadNum > Number(toYmd)) return false;
    return true;
  }

  function matchesHomeDurationFilter(info, filterState) {
    const durationMode = filterState.durationMode;
    if (durationMode === "all") return true;
    const durationSec = Number(info?.duration);
    if (!Number.isFinite(durationSec)) return false;
    if (durationMode === "lt3") return durationSec < 180;
    if (durationMode === "3to20") return durationSec >= 180 && durationSec < 1200;
    if (durationMode === "ge20") return durationSec >= 1200;
    if (durationMode !== "custom") return true;
    if (filterState.durationMinSec !== null && durationSec < filterState.durationMinSec) {
      return false;
    }
    if (filterState.durationMaxSec !== null && durationSec > filterState.durationMaxSec) {
      return false;
    }
    return true;
  }

  function getHomeSearchTermsFromInput(homeSearchInput) {
    const keyword = String(homeSearchInput?.value || "").trim().toLowerCase();
    return keyword.length > 0 ? keyword.split(/\s+/).filter(Boolean) : [];
  }

  function getHomeVideoInfoFromMap(video, homeInfoData) {
    return homeInfoData.get(getVideoIdFromFilename(video.filename)) || null;
  }

  function matchesHomeKeywordTerms(video, info, terms) {
    if (!Array.isArray(terms) || terms.length === 0) return true;
    const source = buildHomeSearchSourceFromVideo(video, info);
    return terms.every((term) => source.includes(term));
  }

  function matchesHomeAdvancedFiltersWithState(video, info, filterState) {
    if (!matchesHomeChannelFilter(info, filterState.channelKeyword)) return false;
    if (!matchesHomeDateFilter(video, info, filterState.fromYmd, filterState.toYmd)) {
      return false;
    }
    return matchesHomeDurationFilter(info, filterState);
  }

  function filterHomeVideosWithInputs(videos, homeInfoData, filterState, terms) {
    return videos.filter((video) => {
      const info = getHomeVideoInfoFromMap(video, homeInfoData);
      if (!matchesHomeKeywordTerms(video, info, terms)) return false;
      return matchesHomeAdvancedFiltersWithState(video, info, filterState);
    });
  }

  function bindHomeFilterPanelToggle(homeFilterBtn, homeFilterPanel) {
    homeFilterBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      homeFilterPanel?.classList.toggle("hidden");
    });
  }

  function bindCloseHomeFilterPanelOnOutsideClick(homeFilterBtn, homeFilterPanel) {
    document.addEventListener("click", (e) => {
      if (!homeFilterPanel || homeFilterPanel.classList.contains("hidden")) return;
      if (homeFilterPanel.contains(e.target) || homeFilterBtn?.contains(e.target)) return;
      homeFilterPanel.classList.add("hidden");
    });
  }

  function bindHomeFilterInputEvents(
    {
      filterDurationRange,
      filterDurationMin,
      filterDurationMax,
      filterChannel,
      filterDateFrom,
      filterDateFromText,
      filterDateTo,
      filterDateToText,
    },
    onChanged,
    onDurationRangeChanged,
  ) {
    filterDurationRange?.addEventListener("change", () => {
      onDurationRangeChanged?.();
      onChanged?.();
    });
    filterDurationMin?.addEventListener("input", () => onChanged?.());
    filterDurationMax?.addEventListener("input", () => onChanged?.());
    filterChannel?.addEventListener("input", () => onChanged?.());
    bindHomeDatePair(filterDateFrom, filterDateFromText, () => onChanged?.());
    bindHomeDatePair(filterDateTo, filterDateToText, () => onChanged?.());
  }

  function getFilteredHomeVideos(
    allVideos,
    homeInfoData,
    homeSearchInputs,
    homeSearchInput,
  ) {
    const filterState = getHomeFilterStateFromInputs(homeSearchInputs);
    const terms = getHomeSearchTermsFromInput(homeSearchInput);
    return filterHomeVideosWithInputs(allVideos, homeInfoData, filterState, terms);
  }

  function renderHomeVideoGridEmpty(homeVideoGrid, message) {
    if (!homeVideoGrid) return;
    homeVideoGrid.innerHTML = `<div class="home-video-empty">${message}</div>`;
  }

  function renderHomeVideoCards(homeVideoGrid, videos, createCard, enrichCardInfo) {
    videos.forEach((video) => {
      const { item, refs } = createCard(video);
      homeVideoGrid.appendChild(item);
      enrichCardInfo(video, refs);
    });
  }

  async function getCachedHomeInfo(homeInfoData, homeInfoCache, video) {
    const videoId = getVideoIdFromFilename(video.filename);
    if (!videoId) return null;
    if (homeInfoData.has(videoId)) return homeInfoData.get(videoId);
    if (!homeInfoCache.has(videoId)) {
      const request = fetch(`/info/${encodeURIComponent(videoId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((info) => {
          if (info) homeInfoData.set(videoId, info);
          return info;
        })
        .catch(() => null);
      homeInfoCache.set(videoId, request);
    }
    return homeInfoCache.get(videoId);
  }

  function applyHomeCardInfoFromInfo(video, refs, info) {
    if (!info || !refs?.titleEl?.isConnected) return;
    refs.titleEl.textContent = info.title?.trim() || video.title;
    refs.channelEl.textContent = info.channel?.trim() || "ローカル動画";
    refs.statsEl.textContent = `${formatHomeViewCountText(info.view_count)} ・ ${formatHomeUploadDateText(info.upload_date)}`;
    const avatar = info.channel_thumbnail?.trim();
    if (avatar) refs.iconEl.src = avatar;
  }

  function createHomeVideoCardFactory(onSelectVideo) {
    return function createHomeVideoCard(video) {
      return createHomeVideoCardElement(video, (selectedVideo) => {
        onSelectVideo(selectedVideo);
      });
    };
  }

  function createHomeCardInfoEnricher(homeInfoData, homeInfoCache) {
    return async function enrichHomeCardInfo(video, refs) {
      const info = await getCachedHomeInfo(homeInfoData, homeInfoCache, video);
      applyHomeCardInfoFromInfo(video, refs, info);
    };
  }

  function renderHomeVideoBrowserGrid({
    homeVideoGrid,
    allVideos,
    homeInfoData,
    homeSearchInputs,
    homeSearchInput,
    createHomeVideoCard,
    enrichHomeCardInfo,
  }) {
    if (!homeVideoGrid) return;
    homeVideoGrid.innerHTML = "";
    if (allVideos.length === 0) {
      renderHomeVideoGridEmpty(homeVideoGrid, "動画が見つかりません");
      return;
    }
    const filteredVideos = getFilteredHomeVideos(
      allVideos,
      homeInfoData,
      homeSearchInputs,
      homeSearchInput,
    );
    if (filteredVideos.length === 0) {
      renderHomeVideoGridEmpty(homeVideoGrid, "検索条件に一致する動画がありません");
      return;
    }
    renderHomeVideoCards(
      homeVideoGrid,
      filteredVideos,
      createHomeVideoCard,
      enrichHomeCardInfo,
    );
  }

  function bindHomeVideoBrowserEvents({
    homeFilterBtn,
    homeFilterPanel,
    filterDurationRange,
    filterDurationMin,
    filterDurationMax,
    filterChannel,
    filterDateFrom,
    filterDateFromText,
    filterDateTo,
    filterDateToText,
    filterClearBtn,
    homeSearchInputs,
    syncAndRender,
    updateDurationCustomInputState,
  }) {
    bindHomeFilterPanelToggle(homeFilterBtn, homeFilterPanel);
    bindCloseHomeFilterPanelOnOutsideClick(homeFilterBtn, homeFilterPanel);
    bindHomeFilterInputEvents(
      {
        filterDurationRange,
        filterDurationMin,
        filterDurationMax,
        filterChannel,
        filterDateFrom,
        filterDateFromText,
        filterDateTo,
        filterDateToText,
      },
      syncAndRender,
      updateDurationCustomInputState,
    );

    filterClearBtn?.addEventListener("click", () => {
      clearHomeFiltersInputs(homeSearchInputs);
      updateDurationCustomInputState();
      syncAndRender();
    });
  }

  function normalizeYyyymmdd(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length < 8) return "";
    return digits.slice(0, 8);
  }

  function yyyymmddToDateInput(value) {
    const ymd = normalizeYyyymmdd(value);
    if (ymd.length !== 8) return "";
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  }

  function dateInputToYyyymmdd(value) {
    return normalizeYyyymmdd(value);
  }

  function parseDurationInput(value) {
    const source = String(value || "").trim();
    if (!source) return null;
    if (/^\d+$/.test(source)) return Number(source);
    const parts = source.split(":").map((v) => v.trim());
    if (parts.length >= 2 && parts.every((p) => /^\d+$/.test(p))) {
      if (parts.length === 2) {
        const mm = Number(parts[0]);
        const ss = Number(parts[1]);
        return mm * 60 + ss;
      }
      if (parts.length === 3) {
        const hh = Number(parts[0]);
        const mm = Number(parts[1]);
        const ss = Number(parts[2]);
        return hh * 3600 + mm * 60 + ss;
      }
    }
    return null;
  }

  function createHomeVideoBrowserController({
    homeVideoGrid,
    homeSearchInput,
    homeFilterBtn,
    homeFilterPanel,
    filterDateFrom,
    filterDateFromText,
    filterDateTo,
    filterDateToText,
    filterDurationRange,
    filterDurationMin,
    filterDurationMax,
    filterChannel,
    filterClearBtn,
    onSelectVideo,
  }) {
    let allVideos = [];
    const homeInfoCache = new Map();
    const homeInfoData = new Map();
    const createHomeVideoCard = createHomeVideoCardFactory(onSelectVideo);
    const enrichHomeCardInfo = createHomeCardInfoEnricher(homeInfoData, homeInfoCache);
    const homeSearchInputs = {
      homeSearchInput,
      filterChannel,
      filterDateFromText,
      filterDateFrom,
      filterDateToText,
      filterDateTo,
      filterDurationRange,
      filterDurationMin,
      filterDurationMax,
    };

    function syncHomeSearchStateToUrl() {
      syncHomeSearchStateToUrlFromInputs(homeSearchInputs);
    }

    function updateDurationCustomInputState() {
      setDurationCustomInputState(
        filterDurationRange,
        filterDurationMin,
        filterDurationMax,
      );
    }

    function syncAndRender() {
      syncHomeSearchStateToUrl();
      render();
    }

    function render() {
      renderHomeVideoBrowserGrid({
        homeVideoGrid,
        allVideos,
        homeInfoData,
        homeSearchInputs,
        homeSearchInput,
        createHomeVideoCard,
        enrichHomeCardInfo,
      });
    }

    function bindEvents() {
      bindHomeVideoBrowserEvents({
        homeFilterBtn,
        homeFilterPanel,
        filterDurationRange,
        filterDurationMin,
        filterDurationMax,
        filterChannel,
        filterDateFrom,
        filterDateFromText,
        filterDateTo,
        filterDateToText,
        filterClearBtn,
        homeSearchInputs,
        syncAndRender,
        updateDurationCustomInputState,
      });
    }

    function initializeHomeVideoBrowser() {
      applyHomeSearchStateFromUrlToInputs(homeSearchInputs);
      homeSearchInput?.addEventListener("input", () => {
        syncAndRender();
      });
      bindEvents();
      updateDurationCustomInputState();
    }

    async function prefetch() {
      const maxPrefetch = 120;
      const concurrency = 6;
      const targets = allVideos.slice(0, maxPrefetch);
      if (targets.length === 0) return;

      for (let i = 0; i < targets.length; i += concurrency) {
        const batch = targets
          .slice(i, i + concurrency)
          .map((video) => getCachedHomeInfo(homeInfoData, homeInfoCache, video));
        await Promise.allSettled(batch);
      }
      render();
    }

    return {
      initialize: initializeHomeVideoBrowser,
      setVideos(videos) {
        allVideos = Array.isArray(videos) ? videos : [];
      },
      render,
      prefetch,
    };
  }

  global.createHomeVideoBrowserController = createHomeVideoBrowserController;
  global.__homeBrowserTestUtils = {
    normalizeYyyymmdd,
    parseDurationInput,
    matchesHomeChannelFilter,
    matchesHomeDateFilter,
    matchesHomeDurationFilter,
    filterHomeVideosWithInputs,
    getHomeFilterStateFromInputs,
  };
})(window);
