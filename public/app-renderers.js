// Home/Comment renderer and filtering module extracted from app.js

const DEFAULT_COMMENT_AVATAR =
        "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='20' r='12' fill='%23999'/%3E%3Cpath d='M12 56c2-14 38-14 40 0' fill='%23ccc'/%3E%3C/svg%3E";

      function normalizeCommentItemForRenderer(comment) {
        if (comment.id && comment.text) {
          if (comment.parent === "root") comment.parent = null;
          return comment;
        }

        const top = comment.comment || comment;
        const parentValue = top.parent;
        return {
          id: top.id || top.comment_id || Math.random().toString(36).slice(2),
          parent: parentValue === "root" ? null : parentValue || null,
          author: top.author || top.author_name || "不明",
          text: top.text || top.content || "",
          like_count: top.like_count || 0,
          _time_text: top._time_text || "",
          author_thumbnail: top.author_thumbnail || null,
          timestamp: top.timestamp || 0,
          is_pinned: top.is_pinned || false,
        };
      }

      function extractRenderableCommentsFromInfo(info) {
        const raw = info.comments || info.comment_threads || [];
        return raw
          .map((comment) => normalizeCommentItemForRenderer(comment))
          .filter((comment) => comment.text && comment.text.trim() !== "");
      }

      function buildCommentTreeFromList(comments) {
        const nodeMap = {};
        comments.forEach((comment) => {
          nodeMap[comment.id] = { ...comment, children: [] };
        });

        comments.forEach((comment) => {
          if (comment.parent && nodeMap[comment.parent]) {
            nodeMap[comment.parent].children.push(nodeMap[comment.id]);
          }
        });

        return comments
          .filter((comment) => !comment.parent)
          .map((comment) => nodeMap[comment.id]);
      }

      function createCommentAvatarLinkElement(comment, defaultCommentAvatar) {
        const avatarLink = document.createElement("a");
        avatarLink.href = "#";
        avatarLink.className = "comment-avatar-link";

        const avatar = document.createElement("img");
        avatar.className = "comment-avatar";
        avatar.loading = "lazy";
        avatar.src =
          comment.author_thumbnail && comment.author_thumbnail !== ""
            ? comment.author_thumbnail
            : defaultCommentAvatar;
        avatar.onerror = () => {
          avatar.src = defaultCommentAvatar;
        };

        avatarLink.appendChild(avatar);
        return avatarLink;
      }

      function createCommentMetaElement(comment) {
        const meta = document.createElement("div");
        meta.className = "comment-meta";

        const author = document.createElement("span");
        author.className = "comment-author";
        author.textContent = comment.author || "@Unknown";

        const time = document.createElement("span");
        time.className = "comment-time";
        time.textContent = comment._time_text || "";

        meta.appendChild(author);
        meta.appendChild(time);
        return meta;
      }

      function createCommentActionsElement(comment) {
        const actions = document.createElement("div");
        actions.className = "comment-actions";

        const btnLike = document.createElement("button");
        btnLike.className = "action-btn";
        btnLike.title = "高評価";
        const likeCountText = comment.like_count > 0 ? comment.like_count : "";
        btnLike.innerHTML = `<i class="fa-regular fa-thumbs-up"></i> ${likeCountText}`;

        const btnReply = document.createElement("button");
        btnReply.className = "action-btn";
        btnReply.textContent = "返信";

        actions.appendChild(btnLike);
        actions.appendChild(btnReply);
        return actions;
      }

      function attachCommentExpandBehavior(textEl, moreBtn) {
        requestAnimationFrame(() => {
          let lineHeight = parseFloat(getComputedStyle(textEl).lineHeight);
          if (isNaN(lineHeight)) lineHeight = 19.6;

          const maxHeight = lineHeight * 4;
          textEl.classList.remove("clamped");

          if (textEl.scrollHeight > maxHeight + 5) {
            textEl.classList.add("clamped");
            moreBtn.style.display = "block";
          }
        });

        moreBtn.addEventListener("click", () => {
          const isClamped = textEl.classList.toggle("clamped");
          moreBtn.textContent = isClamped ? "もっと見る" : "一部を表示";
        });
      }

      function createCommentElementNode(comment, isReply, linkify, defaultCommentAvatar) {
        const item = document.createElement("div");
        item.className = isReply ? "comment-reply" : "comment-item";

        const body = document.createElement("div");
        body.className = "comment-body";

        const text = document.createElement("div");
        text.className = "comment-text";
        text.innerHTML = comment.text ? linkify(comment.text) : "";

        const moreBtn = document.createElement("button");
        moreBtn.className = "comment-more";
        moreBtn.textContent = "もっと見る";
        moreBtn.style.display = "none";

        body.appendChild(createCommentMetaElement(comment));
        body.appendChild(text);
        body.appendChild(moreBtn);
        body.appendChild(createCommentActionsElement(comment));

        item.appendChild(createCommentAvatarLinkElement(comment, defaultCommentAvatar));
        item.appendChild(body);

        attachCommentExpandBehavior(text, moreBtn);
        return item;
      }

      function renderNestedReplyTreeNodes(nodes, container, linkify, defaultCommentAvatar) {
        nodes.forEach((node) => {
          const replyEl = createCommentElementNode(
            node,
            true,
            linkify,
            defaultCommentAvatar,
          );
          container.appendChild(replyEl);

          if (node.children.length > 0) {
            const nested = document.createElement("div");
            nested.className = "comment-replies";
            renderNestedReplyTreeNodes(node.children, nested, linkify, defaultCommentAvatar);
            replyEl.querySelector(".comment-body").appendChild(nested);
          }
        });
      }

      function createReplyControlsForComment(
        parentNode,
        parentEl,
        linkify,
        defaultCommentAvatar,
      ) {
        const replyContainer = document.createElement("div");
        replyContainer.className = "comment-replies";
        replyContainer.id = `replies-${parentNode.id}`;

        const toggleBtn = document.createElement("button");
        toggleBtn.className = "comment-toggle";
        toggleBtn.dataset.parentId = parentNode.id;

        const updateToggleText = (isCollapsed) => {
          toggleBtn.textContent = isCollapsed
            ? `返信${parentNode.children.length}件 ▼`
            : `返信${parentNode.children.length}件 ▲`;
        };
        updateToggleText(true);

        const toggleReplies = () => {
          const container = document.getElementById(
            `replies-${toggleBtn.dataset.parentId}`,
          );
          if (!container) return;
          const isCollapsed = container.classList.toggle("collapsed");
          updateToggleText(isCollapsed);
        };

        toggleBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleReplies();
        });

        renderNestedReplyTreeNodes(
          parentNode.children,
          replyContainer,
          linkify,
          defaultCommentAvatar,
        );
        replyContainer.classList.add("collapsed");

        const bodyEl = parentEl.querySelector(".comment-body");
        bodyEl.appendChild(toggleBtn);
        bodyEl.appendChild(replyContainer);

        const threadHitbox = document.createElement("div");
        threadHitbox.className = "thread-hitbox";
        threadHitbox.title = "返信を開閉";
        threadHitbox.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleReplies();
        });
        parentEl.appendChild(threadHitbox);
      }

      function createCommentRenderer(linkify) {
        function renderComments(comments) {
          const list = document.getElementById("comment-list");
          const countDisplay = document.getElementById("comment-count-display");
          const empty = document.querySelector(".comment-empty");
          if (!list) return;

          list.style.display = "block";
          list.innerHTML = "";
          if (countDisplay) {
            countDisplay.textContent = comments ? comments.length : 0;
          }
          if (!Array.isArray(comments) || comments.length === 0) {
            if (empty) empty.style.display = "block";
            return;
          }
          if (empty) empty.style.display = "none";

          const roots = buildCommentTreeFromList(comments);
          roots.forEach((parentNode) => {
            const parentEl = createCommentElementNode(
              parentNode,
              false,
              linkify,
              DEFAULT_COMMENT_AVATAR,
            );
            parentEl.querySelector(".comment-text")?.classList.add("clamped");
            list.appendChild(parentEl);

            if (parentNode.children.length > 0) {
              createReplyControlsForComment(
                parentNode,
                parentEl,
                linkify,
                DEFAULT_COMMENT_AVATAR,
              );
            }
          });
        }

        return {
          extractRenderableComments: extractRenderableCommentsFromInfo,
          renderComments,
        };
      }

      function getVideoIdFromFilename(filename) {
        return String(filename || "").replace(/\.(mp4|mkv|webm|mov)$/i, "");
      }

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
          if (value) {
            params.set(key, value);
          } else {
            params.delete(key);
          }
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
          if (typeof dateEl.showPicker === "function") {
            dateEl.showPicker();
          } else {
            dateEl.focus();
          }
        });
        dateEl.addEventListener("keydown", (e) => {
          e.preventDefault();
        });

        dateEl.addEventListener("change", () => {
          textEl.value = dateInputToYyyymmdd(dateEl.value);
          onChanged?.();
        });
        textEl.addEventListener("input", () => {
          const ymd = normalizeYyyymmdd(textEl.value);
          if (ymd.length === 8) {
            dateEl.value = yyyymmddToDateInput(ymd);
          }
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

        if (
          filterState.durationMinSec !== null &&
          durationSec < filterState.durationMinSec
        )
          return false;
        if (
          filterState.durationMaxSec !== null &&
          durationSec > filterState.durationMaxSec
        )
          return false;
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
          if (homeFilterPanel.contains(e.target) || homeFilterBtn?.contains(e.target)) {
            return;
          }
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

        if (homeInfoData.has(videoId)) {
          return homeInfoData.get(videoId);
        }

        if (!homeInfoCache.has(videoId)) {
          const request = fetch(`/info/${encodeURIComponent(videoId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((info) => {
              if (info) {
                homeInfoData.set(videoId, info);
              }
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
        if (avatar) {
          refs.iconEl.src = avatar;
        }
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

        if (/^\d+$/.test(source)) {
          return Number(source);
        }

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

      function formatUploadDateForDescription(uploadDate) {
        const value = String(uploadDate || "");
        if (value.length !== 8) return value;
        return `${value.substring(0, 4)}/${value.substring(4, 6)}/${value.substring(6, 8)}`;
      }

      function formatVideoTime(seconds) {
        const total = Math.max(0, Math.floor(seconds || 0));
        const m = Math.floor(total / 60);
        const s = total % 60;
        return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      }

      function formatChannelSubscribers(subCount) {
        if (typeof subCount !== "number") return "登録者数不明";
        if (subCount < 10000) return `${subCount}人`;
        return `${Math.floor(subCount / 1000) / 10}万人`;
      }

      function normalizeLiveChatBaseName(videoBaseName) {
        return String(videoBaseName || "")
          .replace(/\.live_chat\.json$/i, "")
          .replace(/\.(mp4|mkv|webm|mov)$/i, "");
      }

      function parseNdjsonMessages(text) {
        const lines = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        const messages = [];
        for (const line of lines) {
          try {
            messages.push(JSON.parse(line));
          } catch (e) {
            console.warn("パース失敗した行:", line, e);
          }
        }
        return messages;
      }

      function extractChatRenderer(msg) {
        const item =
          msg?.replayChatItemAction?.actions?.[0]?.addChatItemAction?.item;
        return (
          item?.liveChatTextMessageRenderer ||
          item?.liveChatViewerEngagementMessageRenderer ||
          null
        );
      }

      function getChatTimeSec(msg) {
        const timeMs = msg?.replayChatItemAction?.videoOffsetTimeMsec;
        return timeMs ? Math.floor(timeMs / 1000) : null;
      }

      function getChatBadgeInfo(renderer) {
        const badges = renderer?.authorBadges || [];
        const isMember = badges.some(
          (badge) =>
            badge?.liveChatAuthorBadgeRenderer?.tooltip?.includes("Member") ||
            badge?.liveChatAuthorBadgeRenderer?.tooltip?.includes("メンバー"),
        );
        const isModerator = badges.some(
          (badge) =>
            badge?.liveChatAuthorBadgeRenderer?.tooltip?.includes("Moderator") ||
            badge?.liveChatAuthorBadgeRenderer?.tooltip?.includes("モデレーター"),
        );
        const badgeImages = badges
          .map(
            (badge) =>
              badge?.liveChatAuthorBadgeRenderer?.customThumbnail?.thumbnails?.slice(
                -1,
              )[0],
          )
          .filter(Boolean)
          .flat();

        return { isMember, isModerator, badgeImages };
      }

      function renderChatMessageHtml(message) {
        if (!message) return "";
        if (message.simpleText) return escapeHtml(message.simpleText);
        if (!message.runs) return "";

        return message.runs
          .map((run) => {
            if (run.text) return escapeHtml(run.text);
            if (!run.emoji) return "";

            const thumb = run.emoji.image?.thumbnails?.slice(-1)[0];
            if (!thumb?.url) return "";
            const alt =
              run.emoji.image?.accessibility?.accessibilityData?.label ||
              run.emoji.emojiId ||
              "emoji";
            return `<img src="${thumb.url}" alt="${escapeHtml(alt)}" class="chat-emoji">`;
          })
          .join("");
      }

      function createChatAvatarElementForRenderer(renderer, author) {
        const avatar = document.createElement("div");
        avatar.className = "chat-avatar";

        const thumbUrl = renderer?.authorPhoto?.thumbnails?.slice(-1)[0]?.url || null;
        if (thumbUrl) {
          const img = document.createElement("img");
          img.src = thumbUrl;
          img.alt = author;
          img.loading = "lazy";
          avatar.appendChild(img);
        } else {
          avatar.innerHTML = `<i class="fa-solid fa-circle-user"></i>`;
        }

        return avatar;
      }

      function createChatBadgeElementFromImages(badgeImages) {
        const badge = document.createElement("div");
        badge.className = "chat-badge";

        const badgeContainer = document.createElement("div");
        badgeContainer.className = "badge-container";
        badge.appendChild(badgeContainer);

        badgeImages.forEach((thumb) => {
          const img = document.createElement("img");
          img.src = thumb.url;
          img.style.width = "16px";
          img.style.height = "16px";
          badgeContainer.appendChild(img);
        });

        return badge;
      }

      function createChatLineElementFromMessage(msg) {
        const renderer = extractChatRenderer(msg);
        if (!renderer) return null;

        const author = renderer.authorName?.simpleText || "NoName";
        const { isMember, isModerator, badgeImages } = getChatBadgeInfo(renderer);
        const msgHtml =
          renderChatMessageHtml(renderer.message) ||
          renderer.message?.simpleText ||
          "（メッセージなし）";

        const line = document.createElement("div");
        line.className = "chat-line";
        const timeSec = getChatTimeSec(msg);
        if (timeSec !== null) {
          line.dataset.time = timeSec;
        }

        const nameEl = document.createElement("span");
        nameEl.className = "chat-name";
        nameEl.textContent = author;
        if (isModerator) {
          nameEl.classList.add("moderator");
        } else if (isMember) {
          nameEl.classList.add("member");
        }

        const msgEl = document.createElement("span");
        msgEl.className = "chat-message";
        msgEl.innerHTML = msgHtml;

        line.appendChild(createChatAvatarElementForRenderer(renderer, author));
        line.appendChild(nameEl);
        line.appendChild(createChatBadgeElementFromImages(badgeImages));
        line.appendChild(msgEl);
        return line;
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
        const enrichHomeCardInfo = createHomeCardInfoEnricher(
          homeInfoData,
          homeInfoCache,
        );
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
          const requests = allVideos.map((video) =>
            getCachedHomeInfo(homeInfoData, homeInfoCache, video),
          );
          await Promise.allSettled(requests);
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

      
