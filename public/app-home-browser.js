(function attachHomeVideoBrowser(global) {
  const HOME_SORT_STORAGE_KEY = "localtube.homeSortState";
  const ALLOWED_SORT_MODES = new Set([
    "popular_asc",
    "popular_desc",
    "kana_asc",
    "kana_desc",
    "published_asc",
    "published_desc",
  ]);

  function composeSortMode(sortKey, sortOrder) {
    const key = ["popular", "kana", "published"].includes(sortKey)
      ? sortKey
      : "published";
    const order = sortOrder === "asc" ? "asc" : "desc";
    return `${key}_${order}`;
  }

  function normalizeHomeSortState(nextState) {
    const source = nextState && typeof nextState === "object" ? nextState : {};
    return {
      sortKey: ["popular", "kana", "published"].includes(source.sortKey)
        ? source.sortKey
        : "published",
      sortOrder: source.sortOrder === "asc" ? "asc" : "desc",
    };
  }

  function loadHomeSortStateFromStorage() {
    try {
      const raw = global.localStorage?.getItem(HOME_SORT_STORAGE_KEY);
      if (!raw) return null;
      return normalizeHomeSortState(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  function saveHomeSortStateToStorage(sortState) {
    try {
      global.localStorage?.setItem(
        HOME_SORT_STORAGE_KEY,
        JSON.stringify(normalizeHomeSortState(sortState)),
      );
    } catch {
      // noop
    }
  }

  function getHomeFilterStateFromInputs({
    filterChannel,
    filterFilepath,
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
      filePathKeyword: String(filterFilepath?.value || "")
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
    filterFilepath,
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
      fp: String(filterFilepath?.value || "").trim(),
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
    filterFilepath,
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
    if (filterFilepath) filterFilepath.value = params.get("fp") || "";

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
    assignOrDelete("fp", state.fp);
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
    filterFilepath,
  }) {
    if (filterDateFrom) filterDateFrom.value = "";
    if (filterDateFromText) filterDateFromText.value = "";
    if (filterDateTo) filterDateTo.value = "";
    if (filterDateToText) filterDateToText.value = "";
    if (filterDurationRange) filterDurationRange.value = "all";
    if (filterDurationMin) filterDurationMin.value = "";
    if (filterDurationMax) filterDurationMax.value = "";
    if (filterChannel) filterChannel.value = "";
    if (filterFilepath) filterFilepath.value = "";
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

  function formatHomeDurationText(durationSec) {
    const total = Math.floor(Number(durationSec));
    if (!Number.isFinite(total) || total < 0) return "";
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
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

  function matchesHomeFilePathFilter(video, filePathKeyword) {
    if (!filePathKeyword) return true;
    const sourceDir = String(video?.sourceDir || "");
    const filename = String(video?.filename || "");
    const fullPathLike = `${sourceDir}/${filename}`.toLowerCase();
    const terms = String(filePathKeyword)
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (terms.length === 0) return true;
    return terms.every((term) => fullPathLike.includes(term));
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

  function needsFullHomeInfoForAccurateFiltering(filterState, terms, sortState) {
    if (Array.isArray(terms) && terms.length > 0) return true;
    if (String(filterState?.channelKeyword || "").trim()) return true;
    if (String(filterState?.durationMode || "all") !== "all") return true;
    if (String(sortState?.sortKey || "") === "popular") return true;
    return false;
  }

  function countMissingHomeInfo(videos, homeInfoData) {
    let missing = 0;
    for (const video of videos) {
      const videoId = getVideoIdFromFilename(video?.filename);
      if (!videoId) continue;
      if (!homeInfoData.has(videoId)) missing += 1;
    }
    return missing;
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
    if (!matchesHomeFilePathFilter(video, filterState.filePathKeyword)) return false;
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

  function getViewCountForSort(info) {
    const value = Number(info?.view_count);
    return Number.isFinite(value) ? value : 0;
  }

  function getTitleForSort(video, info) {
    return String(info?.title || video?.title || "").trim();
  }

  function getUploadDateNumberForSort(video, info) {
    const ymd = getHomeVideoUploadDateYmd(video, info);
    const num = Number(ymd);
    return Number.isFinite(num) ? num : 0;
  }

  function sortHomeVideosWithMode(videos, homeInfoData, sortMode) {
    const mode = ALLOWED_SORT_MODES.has(sortMode) ? sortMode : "published_desc";
    const sorted = [...videos];
    sorted.sort((a, b) => {
      const infoA = getHomeVideoInfoFromMap(a, homeInfoData);
      const infoB = getHomeVideoInfoFromMap(b, homeInfoData);

      if (mode === "popular_asc" || mode === "popular_desc") {
        const diff = getViewCountForSort(infoA) - getViewCountForSort(infoB);
        if (diff !== 0) return mode === "popular_asc" ? -diff : diff;
      } else if (mode === "kana_asc" || mode === "kana_desc") {
        const titleA = getTitleForSort(a, infoA);
        const titleB = getTitleForSort(b, infoB);
        const diff = titleA.localeCompare(titleB, "ja");
        if (diff !== 0) return mode === "kana_asc" ? diff : -diff;
      } else {
        const diff = getUploadDateNumberForSort(a, infoA) - getUploadDateNumberForSort(b, infoB);
        if (diff !== 0) return mode === "published_asc" ? diff : -diff;
      }

      return String(a?.filename || "").localeCompare(String(b?.filename || ""), "ja");
    });
    return sorted;
  }

  function bindHomeFilterPanelToggle(homeFilterBtn, homeFilterPanel, homeSortPanel) {
    homeFilterBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      homeSortPanel?.classList.add("hidden");
      homeFilterPanel?.classList.toggle("hidden");
    });
  }

  function bindHomeSortPanelToggle(homeSortBtn, homeSortPanel, homeFilterPanel) {
    homeSortBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      homeFilterPanel?.classList.add("hidden");
      homeSortPanel?.classList.toggle("hidden");
    });
  }

  function bindCloseHomeFilterPanelOnOutsideClick(homeFilterBtn, homeFilterPanel) {
    document.addEventListener("click", (e) => {
      if (!homeFilterPanel || homeFilterPanel.classList.contains("hidden")) return;
      if (homeFilterPanel.contains(e.target) || homeFilterBtn?.contains(e.target)) return;
      homeFilterPanel.classList.add("hidden");
    });
  }

  function bindCloseHomeSortPanelOnOutsideClick(homeSortBtn, homeSortPanel) {
    document.addEventListener("click", (e) => {
      if (!homeSortPanel || homeSortPanel.classList.contains("hidden")) return;
      if (homeSortPanel.contains(e.target) || homeSortBtn?.contains(e.target)) return;
      homeSortPanel.classList.add("hidden");
    });
  }

  function applySortButtonsUi(homeSortKeyButtons, homeSortOrderButtons, sortKey, sortOrder) {
    homeSortKeyButtons?.forEach((button) => {
      if (button.dataset.sortKey === sortKey) button.classList.add("active");
      else button.classList.remove("active");
    });
    homeSortOrderButtons?.forEach((button) => {
      if (button.dataset.sortOrder === sortOrder) button.classList.add("active");
      else button.classList.remove("active");
    });
  }

  function bindHomeFilterInputEvents(
    {
      filterDurationRange,
      filterDurationMin,
      filterDurationMax,
      filterChannel,
      filterFilepath,
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
    filterFilepath?.addEventListener("input", () => onChanged?.());
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

  function scheduleNextFrame(callback) {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(callback);
      return;
    }
    setTimeout(callback, 0);
  }

  function buildVideoStableKey(video) {
    return String(video?.filename || "");
  }

  function areStringArraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  }

  function shouldUseHomeVirtualization(videoCount) {
    return false;
  }

  function estimateHomeVirtualColumns(homeVideoGrid) {
    const minCardWidth = 260;
    const gap = 18;
    const width = Math.max(1, Number(homeVideoGrid?.clientWidth || 0));
    return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
  }

  function computeHomeVirtualRange(homeVideoGrid, totalItems) {
    const columns = estimateHomeVirtualColumns(homeVideoGrid);
    const rowHeight = 245;
    const totalRows = Math.ceil(totalItems / columns);
    const gridRect = homeVideoGrid.getBoundingClientRect();
    const viewportTopInGrid = Math.max(0, -gridRect.top);
    const viewportHeight = Math.max(1, window.innerHeight || 1);
    const overscanRows = 3;
    const startRow = Math.max(0, Math.floor(viewportTopInGrid / rowHeight) - overscanRows);
    const visibleRows = Math.ceil(viewportHeight / rowHeight) + overscanRows * 2;
    const endRow = Math.min(totalRows, startRow + visibleRows);
    return {
      startIndex: startRow * columns,
      endIndex: Math.min(totalItems, endRow * columns),
      topSpacerHeight: startRow * rowHeight,
      bottomSpacerHeight: Math.max(0, (totalRows - endRow) * rowHeight),
    };
  }

  function withFallbackThumbPriority(video, priority) {
    if (!video || !video.thumb || !video.thumb.includes("/api/local-thumb-fallback?")) {
      return video;
    }
    try {
      const base = window.location.origin || "http://localhost";
      const url = new URL(video.thumb, base);
      url.searchParams.set("priority", priority);
      return {
        ...video,
        thumb: `${url.pathname}${url.search}`,
      };
    } catch (_error) {
      return video;
    }
  }

  async function renderHomeVideoCardsStaged({
    homeVideoGrid,
    videos,
    createCard,
    enrichCardInfo,
    cardRefsByVideoId,
    renderTokenRef,
    initialBatchSize = 12,
    chunkSize = 18,
  }) {
    if (!homeVideoGrid) return;
    const renderToken = renderTokenRef.current;
    const appendBatch = (start, end) => {
      if (renderTokenRef.current !== renderToken) return false;
      const fragment = document.createDocumentFragment();
      for (let i = start; i < end; i += 1) {
        const sourceVideo = videos[i];
        const priority = i < initialBatchSize ? "high" : "low";
        const video = withFallbackThumbPriority(sourceVideo, priority);
        const { item, refs } = createCard(video);
        const videoId = getVideoIdFromFilename(video.filename);
        if (videoId) {
          cardRefsByVideoId.set(videoId, { video, refs });
        }
        fragment.appendChild(item);
        if (i < initialBatchSize) {
          enrichCardInfo(video, refs);
        }
      }
      homeVideoGrid.appendChild(fragment);
      return true;
    };

    const firstEnd = Math.min(videos.length, initialBatchSize);
    appendBatch(0, firstEnd);

    let offset = firstEnd;
    while (offset < videos.length) {
      await new Promise((resolve) => scheduleNextFrame(resolve));
      const nextEnd = Math.min(offset + chunkSize, videos.length);
      const applied = appendBatch(offset, nextEnd);
      if (!applied) return;
      offset = nextEnd;
    }
  }

  async function fetchHomeInfoBatch(homeInfoData, requestedHomeInfoIds, videos) {
    const ids = videos
      .map((video) => getVideoIdFromFilename(video.filename))
      .filter((id) => id && !homeInfoData.has(id));
    if (ids.length === 0) return;

    const uncachedIds = ids.filter((id) => !requestedHomeInfoIds.has(id));
    if (uncachedIds.length > 0) {
      const HOME_INFO_REQUEST_CHUNK_SIZE = 20;
      const HOME_INFO_MAX_CONCURRENCY = 4;
      const chunks = [];
      for (let i = 0; i < uncachedIds.length; i += HOME_INFO_REQUEST_CHUNK_SIZE) {
        chunks.push(uncachedIds.slice(i, i + HOME_INFO_REQUEST_CHUNK_SIZE));
      }

      uncachedIds.forEach((id) => requestedHomeInfoIds.add(id));

      const workerCount = Math.min(HOME_INFO_MAX_CONCURRENCY, chunks.length);
      const workers = [];
      for (let w = 0; w < workerCount; w += 1) {
        workers.push(
          (async () => {
            while (chunks.length > 0) {
              const chunk = chunks.shift();
              if (!chunk || chunk.length === 0) continue;

              try {
                const response = await fetch(
                  `/api/home-info?ids=${encodeURIComponent(chunk.join(","))}`,
                );
                const payload = response.ok ? await response.json() : null;
                const map = payload?.data || {};
                for (const id of chunk) {
                  const info = map[id] || null;
                  if (info) {
                    homeInfoData.set(id, info);
                    continue;
                  }
                  requestedHomeInfoIds.delete(id);
                }
              } catch (_error) {
                chunk.forEach((id) => requestedHomeInfoIds.delete(id));
              }
            }
          })(),
        );
      }
      await Promise.all(workers);
    }
  }

  function applyHomeCardInfoFromInfo(video, refs, info) {
    if (!info || !refs?.titleEl) return;
    refs.titleEl.textContent = info.title?.trim() || video.title;
    refs.channelEl.textContent = info.channel?.trim() || "ローカル動画";
    refs.statsEl.textContent = `${formatHomeViewCountText(info.view_count)} ・ ${formatHomeUploadDateText(info.upload_date)}`;
    const avatar = info.channel_thumbnail?.trim();
    if (avatar) refs.iconEl.src = avatar;
    if (refs.durationEl) {
      const durationText = formatHomeDurationText(info.duration);
      refs.durationEl.textContent = durationText;
      refs.durationEl.classList.toggle("visible", Boolean(durationText));
    }
  }

  function createHomeVideoCardFactory(onSelectVideo, onOpenVideoOptions) {
    return function createHomeVideoCard(video) {
      return createHomeVideoCardElement(
        video,
        (selectedVideo) => {
          onSelectVideo(selectedVideo);
        },
        onOpenVideoOptions
          ? (selectedVideo, anchorElement) => onOpenVideoOptions(selectedVideo, anchorElement)
          : null,
      );
    };
  }

  function createHomeCardInfoEnricher(homeInfoData) {
    return async function enrichHomeCardInfo(video, refs) {
      const videoId = getVideoIdFromFilename(video.filename);
      if (!videoId) return;
      const info = homeInfoData.get(videoId) || null;
      applyHomeCardInfoFromInfo(video, refs, info);
    };
  }

  async function renderHomeVideoBrowserGrid({
    homeVideoGrid,
    allVideos,
    homeInfoData,
    homeSearchInputs,
    homeSearchInput,
    createHomeVideoCard,
    enrichHomeCardInfo,
    cardRefsByVideoId,
    renderedKeysRef,
    renderTokenRef,
    virtualStateRef,
    thumbLazyLoader,
    shouldRender = () => true,
    onMetric,
  }) {
    if (!homeVideoGrid || !shouldRender()) return;
    const renderStart = performance.now();
    if (allVideos.length === 0) {
      homeVideoGrid.innerHTML = "";
      renderHomeVideoGridEmpty(homeVideoGrid, "動画が見つかりません");
      thumbLazyLoader?.observe();
      return;
    }
    const filteredVideos = getFilteredHomeVideos(
      allVideos,
      homeInfoData,
      homeSearchInputs,
      homeSearchInput,
    );
    if (filteredVideos.length === 0) {
      homeVideoGrid.innerHTML = "";
      renderHomeVideoGridEmpty(homeVideoGrid, "検索条件に一致する動画がありません");
      thumbLazyLoader?.observe();
      return;
    }

    const nextKeys = filteredVideos.map((video) => buildVideoStableKey(video));
    if (areStringArraysEqual(nextKeys, renderedKeysRef.current)) {
      if (virtualStateRef.current.enabled) {
        virtualStateRef.current.schedule?.();
      }
      thumbLazyLoader?.observe();
      return;
    }
    renderedKeysRef.current = nextKeys;
    cardRefsByVideoId.clear();
    homeVideoGrid.innerHTML = "";
    renderTokenRef.current += 1;
    virtualStateRef.current.videos = filteredVideos;
    virtualStateRef.current.enabled = shouldUseHomeVirtualization(filteredVideos.length);

    if (virtualStateRef.current.enabled) {
      const state = virtualStateRef.current;
      state.lastRangeKey = "";
      const renderVirtualWindow = async () => {
        if (!state.enabled || !homeVideoGrid.isConnected) return;
        const range = computeHomeVirtualRange(homeVideoGrid, state.videos.length);
        const rangeKey = `${range.startIndex}:${range.endIndex}:${range.topSpacerHeight}:${range.bottomSpacerHeight}`;
        if (state.lastRangeKey === rangeKey) return;
        state.lastRangeKey = rangeKey;

        const visible = state.videos.slice(range.startIndex, range.endIndex);
        homeVideoGrid.innerHTML = "";
        const topSpacer = document.createElement("div");
        topSpacer.style.height = `${range.topSpacerHeight}px`;
        topSpacer.style.gridColumn = "1 / -1";
        const bottomSpacer = document.createElement("div");
        bottomSpacer.style.height = `${range.bottomSpacerHeight}px`;
        bottomSpacer.style.gridColumn = "1 / -1";
        homeVideoGrid.appendChild(topSpacer);

        await renderHomeVideoCardsStaged({
          homeVideoGrid,
          videos: visible,
          createCard: createHomeVideoCard,
          enrichCardInfo: enrichHomeCardInfo,
          cardRefsByVideoId,
          renderTokenRef,
          initialBatchSize: 12,
          chunkSize: 16,
        });

        homeVideoGrid.appendChild(bottomSpacer);
        thumbLazyLoader?.observe();
      };

      state.schedule = (() => {
        let rafId = null;
        return () => {
          if (rafId !== null) return;
          rafId = requestAnimationFrame(async () => {
            rafId = null;
            await renderVirtualWindow();
          });
        };
      })();

      state.schedule();
    } else {
      await renderHomeVideoCardsStaged({
        homeVideoGrid,
        videos: filteredVideos,
        createCard: createHomeVideoCard,
        enrichCardInfo: enrichHomeCardInfo,
        cardRefsByVideoId,
        renderTokenRef,
      });
      thumbLazyLoader?.observe();
    }
    onMetric?.("home_render_ms", performance.now() - renderStart, {
      total: allVideos.length,
      rendered: filteredVideos.length,
      virtualized: virtualStateRef.current.enabled,
    });
  }

  function bindHomeVideoBrowserEvents({
    homeFilterBtn,
    homeFilterPanel,
    homeSortBtn,
    homeSortPanel,
    homeSortKeyButtons,
    homeSortOrderButtons,
    filterDurationRange,
    filterDurationMin,
    filterDurationMax,
    filterChannel,
    filterFilepath,
    filterDateFrom,
    filterDateFromText,
    filterDateTo,
    filterDateToText,
    filterClearBtn,
    homeSearchInputs,
    syncAndRender,
    updateDurationCustomInputState,
    getSortState,
    setSortState,
  }) {
    bindHomeFilterPanelToggle(homeFilterBtn, homeFilterPanel, homeSortPanel);
    bindHomeSortPanelToggle(homeSortBtn, homeSortPanel, homeFilterPanel);
    bindCloseHomeFilterPanelOnOutsideClick(homeFilterBtn, homeFilterPanel);
    bindCloseHomeSortPanelOnOutsideClick(homeSortBtn, homeSortPanel);
    bindHomeFilterInputEvents(
      {
        filterDurationRange,
        filterDurationMin,
        filterDurationMax,
        filterChannel,
        filterFilepath,
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

    homeSortKeyButtons?.forEach((button) => {
      button.addEventListener("click", () => {
        const nextKey = String(button.dataset.sortKey || "");
        if (!nextKey) return;
        const current = getSortState();
        if (current.sortKey === nextKey) {
          homeSortPanel?.classList.add("hidden");
          return;
        }
        const next = {
          ...current,
          sortKey: nextKey,
        };
        setSortState(next);
        applySortButtonsUi(
          homeSortKeyButtons,
          homeSortOrderButtons,
          next.sortKey,
          next.sortOrder,
        );
        syncAndRender();
        homeSortPanel?.classList.add("hidden");
      });
    });

    homeSortOrderButtons?.forEach((button) => {
      button.addEventListener("click", () => {
        const nextOrder = String(button.dataset.sortOrder || "");
        if (!nextOrder) return;
        const current = getSortState();
        if (current.sortOrder === nextOrder) {
          homeSortPanel?.classList.add("hidden");
          return;
        }
        const next = {
          ...current,
          sortOrder: nextOrder === "asc" ? "asc" : "desc",
        };
        setSortState(next);
        applySortButtonsUi(
          homeSortKeyButtons,
          homeSortOrderButtons,
          next.sortKey,
          next.sortOrder,
        );
        syncAndRender();
        homeSortPanel?.classList.add("hidden");
      });
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

  function isHomePageActive() {
    return document.getElementById("page-home")?.classList.contains("active-page");
  }

  function createHomeThumbLazyLoader(homeVideoGrid) {
    let observer = null;

    const activate = (img) => {
      if (!(img instanceof HTMLImageElement)) return;
      const src = String(img.dataset.thumbSrc || "").trim();
      if (!src || img.src) return;
      img.src = src;
      delete img.dataset.thumbSrc;
    };

    const ensureObserver = () => {
      if (observer || typeof IntersectionObserver !== "function") return;
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            activate(entry.target);
            observer.unobserve(entry.target);
          });
        },
        {
          root: null,
          rootMargin: "240px 0px",
          threshold: 0.01,
        },
      );
    };

    const observe = () => {
      if (!homeVideoGrid) return;
      const targets = homeVideoGrid.querySelectorAll(
        "img.home-video-card-thumb[data-thumb-src]",
      );
      if (!targets.length) return;

      ensureObserver();
      if (!observer) {
        targets.forEach((img) => activate(img));
        return;
      }
      targets.forEach((img) => observer.observe(img));
    };

    const disconnect = () => {
      observer?.disconnect();
    };

    return {
      observe,
      disconnect,
    };
  }

  function createHomeVideoBrowserController({
    homeVideoGrid,
    homeSearchInput,
    homeFilterBtn,
    homeFilterPanel,
    homeSortBtn,
    homeSortPanel,
    homeSortKeyButtons,
    homeSortOrderButtons,
    filterDateFrom,
    filterDateFromText,
    filterDateTo,
    filterDateToText,
    filterDurationRange,
    filterDurationMin,
    filterDurationMax,
    filterChannel,
    filterFilepath,
    filterClearBtn,
    onSelectVideo,
    onOpenVideoOptions = null,
    onMetric = (_name, _value, _meta) => {},
  }) {
    let allVideos = [];
    const requestedHomeInfoIds = new Set();
    const homeInfoData = new Map();
    const cardRefsByVideoId = new Map();
    const renderedKeysRef = { current: [] };
    const renderTokenRef = { current: 0 };
    const virtualStateRef = {
      current: {
        enabled: false,
        videos: [],
        lastRangeKey: "",
        schedule: null,
      },
    };
    let lastFilteredVideos = [];
    let currentSortState = normalizeHomeSortState(loadHomeSortStateFromStorage() || {
      sortKey: "published",
      sortOrder: "desc",
    });
    const createHomeVideoCard = createHomeVideoCardFactory(
      onSelectVideo,
      onOpenVideoOptions,
    );
    const enrichHomeCardInfo = createHomeCardInfoEnricher(homeInfoData);
    const thumbLazyLoader = createHomeThumbLazyLoader(homeVideoGrid);
    let fullInfoFetchPromise = null;
    const homeSearchInputs = {
      homeSearchInput,
      filterChannel,
      filterFilepath,
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

    function updateHomeSearchPlaceholder() {
      if (!homeSearchInput) return;
      const count = Array.isArray(allVideos) ? allVideos.length : 0;
      homeSearchInput.placeholder = `検索（全${count.toLocaleString()}件）`;
    }

    function syncAndRender() {
      syncHomeSearchStateToUrl();
      render();
    }

    async function render() {
      if (!isHomePageActive()) {
        thumbLazyLoader.disconnect();
        return;
      }
      const filterState = getHomeFilterStateFromInputs(homeSearchInputs);
      const terms = getHomeSearchTermsFromInput(homeSearchInput);
      const needsFullInfo = needsFullHomeInfoForAccurateFiltering(
        filterState,
        terms,
        currentSortState,
      );
      if (needsFullInfo) {
        const missingCount = countMissingHomeInfo(allVideos, homeInfoData);
        if (missingCount > 0) {
          if (!fullInfoFetchPromise) {
            fullInfoFetchPromise = fetchHomeInfoBatch(
              homeInfoData,
              requestedHomeInfoIds,
              allVideos,
            ).finally(() => {
              fullInfoFetchPromise = null;
            });
          }
          await fullInfoFetchPromise;
        }
      }
      const filtered = filterHomeVideosWithInputs(
        allVideos,
        homeInfoData,
        filterState,
        terms,
      );
      const sortMode = composeSortMode(
        currentSortState.sortKey,
        currentSortState.sortOrder,
      );
      lastFilteredVideos = sortHomeVideosWithMode(filtered, homeInfoData, sortMode);
      await renderHomeVideoBrowserGrid({
        homeVideoGrid,
        allVideos: lastFilteredVideos,
        homeInfoData,
        homeSearchInputs,
        homeSearchInput,
        createHomeVideoCard,
        enrichHomeCardInfo,
        cardRefsByVideoId,
        renderedKeysRef,
        renderTokenRef,
        virtualStateRef,
        thumbLazyLoader,
        shouldRender: isHomePageActive,
        onMetric,
      });
    }

    function bindEvents() {
      bindHomeVideoBrowserEvents({
        homeFilterBtn,
        homeFilterPanel,
        homeSortBtn,
        homeSortPanel,
        homeSortKeyButtons,
        homeSortOrderButtons,
        filterDurationRange,
        filterDurationMin,
        filterDurationMax,
        filterChannel,
        filterFilepath,
        filterDateFrom,
        filterDateFromText,
        filterDateTo,
        filterDateToText,
        filterClearBtn,
        homeSearchInputs,
        syncAndRender,
        updateDurationCustomInputState,
        getSortState: () => ({ ...currentSortState }),
        setSortState: (nextState) => {
          currentSortState = normalizeHomeSortState(nextState);
          saveHomeSortStateToStorage(currentSortState);
        },
      });

      let virtualTicking = false;
      const scheduleVirtualRerender = () => {
        if (!virtualStateRef.current.enabled || !virtualStateRef.current.schedule) return;
        if (virtualTicking) return;
        virtualTicking = true;
        requestAnimationFrame(() => {
          virtualTicking = false;
          virtualStateRef.current.schedule();
        });
      };
      window.addEventListener("scroll", scheduleVirtualRerender, { passive: true });
      window.addEventListener("resize", scheduleVirtualRerender);
      window.addEventListener("app:page-changed", (event) => {
        const pageId = event?.detail?.pageId;
        if (pageId === "page-home") {
          render();
          return;
        }
        thumbLazyLoader.disconnect();
      });
    }

    function initializeHomeVideoBrowser() {
      applyHomeSearchStateFromUrlToInputs(homeSearchInputs);
      applySortButtonsUi(
        homeSortKeyButtons,
        homeSortOrderButtons,
        currentSortState.sortKey,
        currentSortState.sortOrder,
      );
      homeSearchInput?.addEventListener("input", () => {
        syncAndRender();
      });
      updateHomeSearchPlaceholder();
      bindEvents();
      updateDurationCustomInputState();
    }

    async function prefetch() {
      const maxPrefetch = 40;
      const prioritized = [
        ...lastFilteredVideos,
        ...allVideos.filter((video) => !lastFilteredVideos.includes(video)),
      ];
      const targets = prioritized.slice(0, maxPrefetch);
      if (targets.length === 0) return;

      const startedAt = performance.now();
      const batchSize = 40;
      for (let i = 0; i < targets.length; i += batchSize) {
        const batch = targets.slice(i, i + batchSize);
        await fetchHomeInfoBatch(homeInfoData, requestedHomeInfoIds, batch);
      }
      onMetric?.("home_prefetch_ms", performance.now() - startedAt, {
        targetCount: targets.length,
      });
      for (const video of targets) {
        const videoId = getVideoIdFromFilename(video.filename);
        const mapped = cardRefsByVideoId.get(videoId);
        const info = homeInfoData.get(videoId);
        if (mapped && info) {
          applyHomeCardInfoFromInfo(mapped.video, mapped.refs, info);
        }
      }
    }

    return {
      initialize: initializeHomeVideoBrowser,
      setVideos(videos) {
        allVideos = Array.isArray(videos) ? videos : [];
        updateHomeSearchPlaceholder();
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
