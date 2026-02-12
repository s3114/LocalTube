let pendingVideoId = null;

      // --- Global State ---
      const jobStates = new Map();

      // --- Helper Functions ---
      function getStatusIcon(status) {
        switch (status) {
          case "queued":
            return "🕒";
          case "downloading":
            return "⬇️";
          case "completed":
            return "✅";
          case "error":
            return "❌";
          default:
            return "❔";
        }
      }

      function getJobProgressData(job) {
        if (job.status === "downloading") {
          return {
            width: `${job.progress.percentage || 0}%`,
            text: `${job.progress.percentage}% of ${job.progress.totalSize} at ${job.progress.speed} ETA ${job.progress.eta}`,
            hints: [],
          };
        }

        if (job.status === "completed") {
          return {
            width: "100%",
            text: job.progress.eta || "完了",
            hints: [],
          };
        }

        if (job.status !== "error") {
          return {
            width: "0%",
            text: job.progress.eta || job.status,
            hints: [],
          };
        }

        const errorMessage = job.progress.eta || "エラー";
        const hints = [];
        if (errorMessage.includes("Sign in to confirm you’re not a bot")) {
          hints.push(
            "Cookieファイルを指定し、再度ダウンロードを実行してください。",
          );
        }
        if (errorMessage.includes("skipped as they are DRM protected")) {
          hints.push(
            "DRM保護の動画のトグルを有効にし再度ダウンロードを実行してください。",
          );
        }
        if (errorMessage.includes("Join this channel to get access to members")) {
          hints.push("正しいCookieファイルを指定し、再度ダウンロードを実行してください。");
        }
        if (errorMessage.includes("Requested format is not available")) {
          hints.push(
            "このエラーは様々な理由で発生します。最大の原因はショート動画のDLです。詳しくはサポートサーバーにて質問して下さい。",
          );
        }
        if (errorMessage.includes("HTTP Error 403: Forbidden")) {
          hints.push(
            "情報不足にて確実な対処方法が確立していません。詳しくはサポートサーバーにて質問して下さい。",
          );
        }
        if (errorMessage.includes("Unsupported URL: ")) {
          hints.push("そのURLはサポートされていません。");
        }
        if (errorMessage.includes("' is not a valid URL")) {
          hints.push("URLが有効ではありません。");
        }

        return { width: "100%", text: errorMessage, hints };
      }

      function renderJobProgressText(container, text, hints = []) {
        container.textContent = text;
        hints.forEach((hint) => {
          container.appendChild(document.createElement("br"));
          const span = document.createElement("span");
          span.className = "cookie-error-hint";
          span.textContent = hint;
          container.appendChild(span);
        });
      }

      function renderJob(job) {
        jobStates.set(job.id, job);
        const statusIcon = getStatusIcon(job.status);
        const progress = getJobProgressData(job);

        const item = document.createElement("div");
        item.className = "job-item";
        item.id = `job-${job.id}`;
        item.dataset.status = job.status;

        const iconEl = document.createElement("div");
        iconEl.className = "job-status-icon";
        iconEl.textContent = statusIcon;

        const detailsEl = document.createElement("div");
        detailsEl.className = "job-details";

        const titleEl = document.createElement("div");
        titleEl.className = "job-title";
        titleEl.title = job.title;
        titleEl.textContent = job.title;

        const progressBarContainer = document.createElement("div");
        progressBarContainer.className = "job-progress-bar-container";

        const progressBar = document.createElement("div");
        progressBar.className = "job-progress-bar";
        progressBar.style.width = progress.width;
        progressBarContainer.appendChild(progressBar);

        const progressTextEl = document.createElement("div");
        progressTextEl.className = "job-progress-text";
        renderJobProgressText(progressTextEl, progress.text, progress.hints);

        detailsEl.appendChild(titleEl);
        detailsEl.appendChild(progressBarContainer);
        detailsEl.appendChild(progressTextEl);
        item.appendChild(iconEl);
        item.appendChild(detailsEl);
        return item;
      }

      function escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
      }

      function escapeAttr(str) {
        return String(str || "")
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
      }

      function linkifyText(text) {
        if (!text) return "";
        const source = String(text);
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parts = [];
        let lastIndex = 0;

        for (const match of source.matchAll(urlRegex)) {
          const url = match[0];
          const start = match.index ?? 0;
          parts.push(escapeHtml(source.slice(lastIndex, start)));
          parts.push(
            `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="desc-link">${escapeHtml(url)}</a>`,
          );
          lastIndex = start + url.length;
        }

        parts.push(escapeHtml(source.slice(lastIndex)));
        return parts.join("");
      }

      function updateJobElement(job) {
        const jobElement = document.getElementById(`job-${job.id}`);
        if (!jobElement) return;

        jobElement.dataset.status = job.status;
        jobElement.querySelector(".job-status-icon").textContent =
          getStatusIcon(job.status);
        jobElement.querySelector(".job-title").textContent = job.title;
        jobElement.querySelector(".job-title").title = job.title;

        const progressBar = jobElement.querySelector(".job-progress-bar");
        const progressTextElement =
          jobElement.querySelector(".job-progress-text");

        const progress = getJobProgressData(job);
        progressBar.style.width = progress.width;
        renderJobProgressText(progressTextElement, progress.text, progress.hints);
      }

      async function parseApiResponse(response) {
        let payload = null;
        try {
          payload = await response.json();
        } catch (_error) {
          payload = null;
        }

        if (payload && typeof payload.ok === "boolean") {
          return {
            ok: Boolean(payload.ok) && response.ok,
            status: response.status,
            data: payload.data ?? null,
            error: payload.error ?? null,
            raw: payload,
          };
        }

        return {
          ok: response.ok,
          status: response.status,
          data: response.ok ? payload : null,
          error: response.ok
            ? null
            : payload?.error || payload?.message || `HTTP ${response.status}`,
          raw: payload,
        };
      }

      function saveLocalSetting(key, value) {
        try {
          localStorage.setItem(key, value);
        } catch (e) {
          console.warn("localStorage 保存失敗:", e);
        }
      }

      function loadLocalSetting(key, defaultValue) {
        try {
          const storedValue = localStorage.getItem(key);
          if (storedValue === null) return defaultValue;
          if (typeof defaultValue === "boolean") return storedValue === "true";
          return storedValue;
        } catch (e) {
          console.warn("localStorage 読み込み失敗:", e);
          return defaultValue;
        }
      }

      function normalizeDirListForUi(dirList) {
        if (!Array.isArray(dirList)) return [];
        const normalized = [];
        for (const raw of dirList) {
          const value = String(raw || "").trim();
          if (!value) continue;
          if (!normalized.includes(value)) normalized.push(value);
        }
        return normalized;
      }

      function countJobsByStatus(jobStates) {
        let completed = 0;
        let running = 0;
        let error = 0;

        for (const job of jobStates.values()) {
          if (job.status === "completed") {
            completed++;
          } else if (job.status === "downloading") {
            running++;
          } else if (job.status === "error") {
            error++;
          }
        }

        const total = completed + running + error;
        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
        return { total, completed, running, error, completionRate };
      }

      function renderDashboardJobCounts(jobCounts) {
        const totalEl = document.getElementById("info-total-count");
        const completedEl = document.getElementById("info-completed-count");
        const runningEl = document.getElementById("info-running-count");
        const errorEl = document.getElementById("info-error-count");
        if (totalEl) totalEl.textContent = `${jobCounts.total} 件`;
        if (completedEl) completedEl.textContent = `${jobCounts.completed} 件`;
        if (runningEl) runningEl.textContent = `${jobCounts.running} 件`;
        if (errorEl) errorEl.textContent = `${jobCounts.error} 件`;

        const bar = document.getElementById("completion-bar");
        const text = document.getElementById("completion-text");
        if (bar) bar.style.width = `${jobCounts.completionRate}%`;
        if (text) text.textContent = `${jobCounts.completionRate}%`;
      }

      function updateDashboardServerClock(serverTime) {
        if (!serverTime) return;
        const clockEl = document.getElementById("info-clock");
        if (!clockEl) return;
        clockEl.textContent =
          `${serverTime.yyyy}/${serverTime.MM}/${serverTime.dd} ` +
          `${serverTime.hh}:${serverTime.mm}:${serverTime.ss}`;
      }

      function updateDashboardNetworkLatency(data) {
        const netEl = document.getElementById("info-network");
        if (netEl && data.network_mbps != null) {
          netEl.textContent = `${data.network_mbps} Mbps (推定)`;
        }
        const latEl = document.getElementById("info-latency");
        if (latEl && data.latency_ms != null) {
          latEl.textContent = `${data.latency_ms} ms`;
        }
      }

      function updateDashboardUptime(uptimeSec) {
        const upEl = document.getElementById("info-uptime");
        if (!upEl || typeof uptimeSec !== "number") return;

        const h = Math.floor(uptimeSec / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        const s = uptimeSec % 60;
        upEl.textContent = `${h}時間 ${m}分 ${s}秒`;
      }

      function createDashboardNetworkChart() {
        const canvas = document.getElementById("networkChart");
        if (!canvas) return null;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        return new Chart(ctx, {
          type: "line",
          data: {
            labels: [],
            datasets: [
              {
                label: "推定Mbps",
                data: [],
                tension: 0.3,
              },
              {
                label: "レイテンシ(ms)",
                data: [],
                tension: 0.3,
                yAxisID: "y2",
              },
            ],
          },
          options: {
            animation: false,
            scales: {
              x: {
                title: { display: true, text: "秒" },
              },
              y: {
                title: { display: true, text: "Mbps" },
                position: "left",
              },
              y2: {
                title: { display: true, text: "ms" },
                position: "right",
                grid: { drawOnChartArea: false },
              },
            },
          },
        });
      }

      function pushAveragedDashboardSample(
        networkChart,
        netBuffer,
        latencyBuffer,
        avgWindow,
        mbps,
        latencyMs,
      ) {
        if (!networkChart || mbps == null || latencyMs == null) return;

        netBuffer.push(mbps);
        latencyBuffer.push(latencyMs);
        if (netBuffer.length > avgWindow) netBuffer.shift();
        if (latencyBuffer.length > avgWindow) latencyBuffer.shift();

        const avgMbps = Math.round(
          netBuffer.reduce((a, b) => a + b, 0) / netBuffer.length,
        );
        const avgLatency = Math.round(
          latencyBuffer.reduce((a, b) => a + b, 0) / latencyBuffer.length,
        );

        const now = new Date();
        const timeLabel = `${now.getMinutes()}:${now
          .getSeconds()
          .toString()
          .padStart(2, "0")}`;

        networkChart.data.labels.push(timeLabel);
        networkChart.data.datasets[0].data.push(avgMbps);
        networkChart.data.datasets[1].data.push(avgLatency);

        if (networkChart.data.labels.length > 30) {
          networkChart.data.labels.shift();
          networkChart.data.datasets[0].data.shift();
          networkChart.data.datasets[1].data.shift();
        }

        networkChart.update();
      }

      function replaceDashboardJobs(jobQueueElement, jobs) {
        if (!jobQueueElement) return;
        jobQueueElement.innerHTML = "";
        const frag = document.createDocumentFragment();
        jobs.forEach((job) => {
          frag.appendChild(renderJob(job));
        });
        jobQueueElement.appendChild(frag);
      }

      function appendDashboardJobs(jobQueueElement, jobs) {
        if (!jobQueueElement) return;
        const frag = document.createDocumentFragment();
        jobs.forEach((job) => {
          frag.appendChild(renderJob(job));
        });
        jobQueueElement.appendChild(frag);
      }

      function prependDashboardConnectionError() {
        const jobQueueDiv = document.getElementById("job-queue");
        if (!jobQueueDiv) return;
        jobQueueDiv.innerHTML =
          '<div class="status-warn-text">サーバーとの接続が切れました。起動.batが正常に動作しているか確認してください。</div>' +
          jobQueueDiv.innerHTML;
      }

      function applyDashboardJobPatch({ id, patch, onJobUpdated, updateCounts }) {
        const job = jobStates.get(id);
        if (!job) return;
        Object.assign(job, patch);
        updateJobElement(job);
        if (updateCounts) {
          renderDashboardJobCounts(countJobsByStatus(jobStates));
        }
        onJobUpdated?.();
      }

      function createDashboardSseController({
        jobQueueElement,
        onJobUpdated,
      }) {
        const netBuffer = [];
        const latencyBuffer = [];
        const AVG_WINDOW = 5;
        const networkChart = createDashboardNetworkChart();

        const eventSource = new EventSource("/events");

        eventSource.addEventListener("initial_state", (e) => {
          const jobs = JSON.parse(e.data);
          replaceDashboardJobs(jobQueueElement, jobs);
          renderDashboardJobCounts(countJobsByStatus(jobStates));
        });

        eventSource.addEventListener("jobs_added", (e) => {
          const newJobs = JSON.parse(e.data);
          appendDashboardJobs(jobQueueElement, newJobs);
          renderDashboardJobCounts(countJobsByStatus(jobStates));
        });

        eventSource.addEventListener("title_update", (e) => {
          const { id, title } = JSON.parse(e.data);
          applyDashboardJobPatch({
            id,
            patch: { title },
            onJobUpdated,
            updateCounts: false,
          });
        });

        eventSource.addEventListener("progress_update", (e) => {
          const { id, progress } = JSON.parse(e.data);
          applyDashboardJobPatch({
            id,
            patch: { progress },
            onJobUpdated,
            updateCounts: false,
          });
        });

        eventSource.addEventListener("status_update", (e) => {
          const { id, status, progress, error } = JSON.parse(e.data);
          const patch = { status };
          if (progress) patch.progress = progress;
          if (error) patch.error = error;
          applyDashboardJobPatch({
            id,
            patch,
            onJobUpdated,
            updateCounts: true,
          });
        });

        eventSource.onerror = (err) => {
          console.error("EventSource failed:", err);
          prependDashboardConnectionError();
          eventSource.close();
        };

        eventSource.addEventListener("system_info", (e) => {
          const data = JSON.parse(e.data);
          updateDashboardServerClock(data.server_time);
          updateDashboardNetworkLatency(data);
          updateDashboardUptime(data.uptime_sec);
          pushAveragedDashboardSample(
            networkChart,
            netBuffer,
            latencyBuffer,
            AVG_WINDOW,
            data.network_mbps,
            data.latency_ms,
          );
        });
      }

      function createHomeCardThumbElement(video) {
        const thumbEl = video.thumb
          ? document.createElement("img")
          : document.createElement("div");
        thumbEl.className = "home-video-card-thumb";
        if (video.thumb) {
          thumbEl.src = video.thumb;
          thumbEl.loading = "lazy";
        }
        return thumbEl;
      }

      function createHomeCardMetaElements(video) {
        const metaEl = document.createElement("div");
        metaEl.className = "home-video-card-meta";

        const iconEl = document.createElement("img");
        iconEl.className = "home-video-channel-icon";
        iconEl.src = "/none_icon.jpg";
        iconEl.alt = "channel icon";
        iconEl.loading = "lazy";
        iconEl.onerror = () => {
          iconEl.src = "/none_icon.jpg";
        };

        const textsEl = document.createElement("div");
        textsEl.className = "home-video-card-texts";

        const titleEl = document.createElement("div");
        titleEl.className = "home-video-card-title";
        titleEl.textContent = video.title;

        const channelEl = document.createElement("div");
        channelEl.className = "home-video-card-channel";
        channelEl.textContent = "ローカル動画";

        const statsEl = document.createElement("div");
        statsEl.className = "home-video-card-stats";
        statsEl.textContent = "視聴回数不明 ・ 投稿日不明";

        textsEl.appendChild(titleEl);
        textsEl.appendChild(channelEl);
        textsEl.appendChild(statsEl);
        metaEl.appendChild(iconEl);
        metaEl.appendChild(textsEl);

        return { metaEl, refs: { titleEl, channelEl, statsEl, iconEl } };
      }

      function createHomeVideoCardElement(video, onClick) {
        const item = document.createElement("div");
        item.className = "home-video-card";
        item.appendChild(createHomeCardThumbElement(video));

        const { metaEl, refs } = createHomeCardMetaElements(video);
        item.appendChild(metaEl);
        item.addEventListener("click", () => onClick(video));

        return { item, refs };
      }

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
          } else if (lastSelectedFilename) {
            ui.titleEl.textContent = lastSelectedFilename.replace(
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
        ui.statLikes.textContent = info.like_count ? info.like_count.toLocaleString() : "---";
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
          const idFromFilename = videoItem.filename.replace(
            /\.(mp4|mkv|webm|mov)$/i,
            "",
          );
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
        lastSelectedFilename = video.filename;
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
            console.error("Play failed:", err);
          }
        });
      }

      function navigateToPlayerPageFromVideoId(videoId, onAfterNavigate) {
        history.pushState(null, "", `#player/${encodeURIComponent(videoId)}`);
        document
          .querySelectorAll(".page")
          .forEach((page) => page.classList.remove("active-page"));
        document.getElementById("page-player")?.classList.add("active-page");
        window.updateHeaderSearchVisibility?.("page-player");
        window.updateSmoothSeekLoopState?.();

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
            createLocalVideoListItemElement(
              video,
              (selectedVideo, selectedItem) => onSelect(selectedVideo, selectedItem),
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

      function createVideoDataController({
        linkify,
        updateDescButton,
      }) {
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

          window.currentVideoComments = commentRenderer.extractRenderableComments(info);
          commentRenderer.renderComments(window.currentVideoComments);
        }

        async function loadLiveChat(videoBaseName) {
          chatRequestToken += 1;
          const currentChatToken = chatRequestToken;
          if (chatAbortController) {
            chatAbortController.abort();
          }
          chatAbortController = new AbortController();

          try {
            if (!ui.chatContainer) {
              console.error("chat-messages が見つかりません");
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
              return;
            }

            if (ui.chatEmpty) ui.chatEmpty.style.display = "none";
            renderVideoLiveChatMessages(ui.chatContainer, messages);
            ui.chatContainer.scrollTop = ui.chatContainer.scrollHeight;
          } catch (e) {
            if (e?.name === "AbortError") return;
            console.error("loadLiveChat error:", e);
            if (ui.chatEmpty) ui.chatEmpty.textContent = "チャットの読み込みに失敗しました";
          }
        }

        function loadCurrentVideoSideData(videoId) {
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
            })
            .catch((err) => {
              if (err?.name === "AbortError") return;
              console.error("info.json 読み込み失敗:", err);
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

        function playLocalVideo(video, activeItem = null, shouldAutoplay = true) {
          const videoId = getVideoIdFromFilename(video.filename);
          activateLocalVideoListItem(activeItem);
          setupLocalVideoPlayerSource(videoPlayer, titleEl, onResetSeekBar, video);
          tryAutoplayLocalVideo(videoPlayer, shouldAutoplay);
          onLoadSideData?.(videoId);
          navigateToPlayerPageFromVideoId(videoId, onAfterNavigate);
        }

        async function loadLocalVideos() {
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
            onPrefetchHomeInfos?.();

            if (pendingVideoId) {
              const matchedVideo = findLocalVideoById(allLocalVideos, pendingVideoId);
              if (matchedVideo) {
                const matchedItem = findLocalVideoListItem(
                  videoList,
                  matchedVideo.filename,
                );
                playLocalVideo(matchedVideo, matchedItem || null, false);
                pendingVideoId = null;
              }
            }
          } catch (e) {
            console.error("Failed to load local videos:", e);
            showLocalVideoListLoadError(videoList, homeVideoGrid);
          }
        }

        return {
          playLocalVideo,
          loadLocalVideos,
        };
      }

      // --- Main Logic ---
      function initializeSettingsAndSse() {
        const elements = {
          fmt: document.getElementById("fmt"),
          savePath: document.getElementById("savePath"),
          optHistory: document.getElementById("optHistory"),
          optThumb: document.getElementById("optThumb"),
          optDrm: document.getElementById("optDrm"),
          optParallelDownloads: document.getElementById("optParallelDownloads"),
          parallelDownloadsValue: document.getElementById(
            "parallelDownloadsValue",
          ),
          optConcurrentFragments: document.getElementById(
            "optConcurrentFragments",
          ),
          concurrentFragmentsValue: document.getElementById(
            "concurrentFragmentsValue",
          ),
          urls: document.getElementById("urls"),
          jobQueue: document.getElementById("job-queue"),
          // New Cookie UI elements
          cookieStatusDisplay: document.getElementById("cookie-status-display"),
          setFirefoxBtn: document.getElementById("set-firefox-btn"),
          manualSelectBtn: document.getElementById("manual-select-btn"),
          noneSelectBtn: document.getElementById("none-select-btn"),
          cookiePathSet: document.getElementById("cookiePathSet"),
          commentOptions: document.getElementById("comment-options"),
          clearHistoryBtn: document.getElementById("clearHistoryBtn"),
          localVideoDirsInput: document.getElementById("local-video-dirs-input"),
          saveLocalVideoDirsBtn: document.getElementById(
            "save-local-video-dirs-btn",
          ),
          localVideoDirsStatus: document.getElementById("local-video-dirs-status"),
          optFallbackThumbnails: document.getElementById(
            "opt-fallback-thumbnails",
          ),
          wallpaperStatus: document.getElementById("wallpaper-status"),
          wallpaperFileInput: document.getElementById("wallpaper-file-input"),
          wallpaperSelectBtn: document.getElementById("wallpaper-select-btn"),
          wallpaperClearBtn: document.getElementById("wallpaper-clear-btn"),
          wallpaperBlurRange: document.getElementById("wallpaper-blur-range"),
          wallpaperBlurValue: document.getElementById("wallpaper-blur-value"),
          wallpaperBrightnessRange: document.getElementById(
            "wallpaper-brightness-range",
          ),
          wallpaperBrightnessValue: document.getElementById(
            "wallpaper-brightness-value",
          ),
        };
        initializeSettingsUiController({
          elements,
          onLocalVideosChanged: async () => {
            await window.refreshLocalVideos?.();
          },
        });

        createDashboardSseController({
          jobQueueElement: elements.jobQueue,
        });
      }

      // --- Actions ---
      function setButtonDisabled(button, disabled) {
        if (button) button.disabled = disabled;
      }

      function parseInputUrls(urlsInput) {
        const rawUrls = String(urlsInput?.value || "").trim();
        if (rawUrls === "") {
          alert("URLを入力してください。");
          return null;
        }

        const urls = rawUrls.split(/[\n\s,]+/).filter((url) => url.trim() !== "");
        if (urls.length === 0) {
          alert("URLを入力してください。");
          return null;
        }
        return urls;
      }

      async function validateSingleUrl(url) {
        if (!url.startsWith("https://")) {
          alert(
            `「${url}」は有効なURLではありません。https:// で始まるURLを入力してください。`,
          );
          return false;
        }

        const validationResponse = await fetch(
          `/api/validate-url?url=${encodeURIComponent(url)}`,
        );
        const validationResult = await parseApiResponse(validationResponse);
        const validationData = validationResult.data || {};
        if (validationData.isValid) return true;
        const errorMessage = validationData.error || validationResult.error || "";

        alert(
          `「${url}」はアクセスできません。${errorMessage ? `エラー: ${errorMessage}` : ""}`,
        );
        return false;
      }

      async function validateUrls(urls) {
        for (const url of urls) {
          const valid = await validateSingleUrl(url);
          if (!valid) return false;
        }
        return true;
      }

      function buildDownloadFormData(urlsInput) {
        const formData = new FormData();
        formData.append("urls", urlsInput.value);
        formData.append("format", document.getElementById("fmt").value);
        formData.append("saveHistory", document.getElementById("optHistory").checked);
        formData.append("downloadThumb", document.getElementById("optThumb").checked);
        formData.append("drmProtect", document.getElementById("optDrm").checked);
        formData.append("savePath", document.getElementById("savePath").value);
        formData.append(
          "parallelDownloads",
          document.getElementById("optParallelDownloads").value,
        );
        formData.append(
          "concurrentFragments",
          document.getElementById("optConcurrentFragments").value,
        );
        formData.append(
          "commentOptions",
          document.getElementById("comment-options").value,
        );

        if (window.selectedCookieFile) {
          formData.append("cookieFile", window.selectedCookieFile);
        }
        return formData;
      }

      async function submitDownload(formData) {
        const response = await fetch("/download", {
          method: "POST",
          body: formData,
        });
        const result = await parseApiResponse(response);
        if (result.ok) return true;

        alert(`エラー: ${result.error || "ダウンロードの開始に失敗しました。"}`);
        return false;
      }

      async function start() {
        const downloadBtn = document.getElementById("download-btn");
        const urlsInput = document.getElementById("urls");
        setButtonDisabled(downloadBtn, true);

        try {
          const urls = parseInputUrls(urlsInput);
          if (!urls) return;

          const valid = await validateUrls(urls);
          if (!valid) return;

          const formData = buildDownloadFormData(urlsInput);
          const submitted = await submitDownload(formData);
          if (submitted) {
            urlsInput.value = "";
          }
        } catch (error) {
          alert(
            `ネットワークエラーまたは検証中に問題が発生しました: ${error.message}`,
          );
          console.error("Fetch error:", error);
        } finally {
          setButtonDisabled(downloadBtn, false);
        }
      }

      // ===== ヘッダーボタンとURLルーティング =====
      function initializeHeaderRouting() {
        const buttons = document.querySelectorAll(".icon-btn");
        const pages = document.querySelectorAll(".page");
        const headerSearchWrap = document.querySelector(".header-search-wrap");

        window.updateHeaderSearchVisibility = (pageId) => {
          if (!headerSearchWrap) return;
          headerSearchWrap.style.display =
            pageId === "page-home" ? "flex" : "none";
        };

        function showPage(pageId) {
          // すべて非表示
          pages.forEach((p) => p.classList.remove("active-page"));

          // 指定ページだけ表示
          const target = document.getElementById(pageId);
          if (target) {
            target.classList.add("active-page");
          }
          window.updateHeaderSearchVisibility(pageId);
          window.updateSmoothSeekLoopState?.();
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

          // player/ID を分解
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
            pendingVideoId = decodeURIComponent(videoId);
          }
        }

        // ボタンクリック時 → URLも変更
        buttons.forEach((btn) => {
          btn.addEventListener("click", () => {
            const pageId = btn.dataset.page;

            // URLを更新（ページ再読み込みなし）
            const hash = pageId.replace("page-", ""); // page-player → player
            history.pushState(null, "", "#" + hash);

            showPage(pageId);
            setActiveButton(pageId);
          });
        });

        // ブラウザの「戻る／進む」に対応
        window.addEventListener("popstate", routeFromHash);

        // 初期表示（URLに合わせて表示）
        routeFromHash();
      }

      function initializePlayerPage() {
        const elements = getPlayerPageElements();
        const descriptionController = createDescriptionController(
          elements.desc,
          elements.toggleBtn,
        );
        const chatHeightController = createChatHeightController(
          elements.playerMain,
          elements.chatSection,
          elements.chatContent,
        );

        let localVideoController = null;
        const homeVideoBrowser = createHomeVideoBrowserController({
          homeVideoGrid: elements.homeVideoGrid,
          homeSearchInput: elements.homeSearchInput,
          homeFilterBtn: elements.homeFilterBtn,
          homeFilterPanel: elements.homeFilterPanel,
          filterDateFrom: elements.filterDateFrom,
          filterDateFromText: elements.filterDateFromText,
          filterDateTo: elements.filterDateTo,
          filterDateToText: elements.filterDateToText,
          filterDurationRange: elements.filterDurationRange,
          filterDurationMin: elements.filterDurationMin,
          filterDurationMax: elements.filterDurationMax,
          filterChannel: elements.filterChannel,
          filterClearBtn: elements.filterClearBtn,
          onSelectVideo: (selectedVideo) => {
            localVideoController?.playLocalVideo(selectedVideo);
          },
        });
        homeVideoBrowser.initialize();

        const videoDataController = createVideoDataController({
          linkify: linkifyText,
          updateDescButton: descriptionController.updateDescButton,
        });

        const playerUi = createPlayerUiController({
          videoPlayer: elements.videoPlayer,
          seekBar: elements.seekBar,
          btnPlay: elements.btnPlay,
          btnFull: elements.btnFull,
          timeDisplay: elements.timeDisplay,
          onToggleFullscreen: createPlayerFullscreenToggleHandler(elements.videoPlayer),
          onSidebarToggled: chatHeightController.sync,
          renderSortedComments: (sorted) => {
            videoDataController.renderSortedComments(sorted);
          },
        });

        localVideoController = createLocalVideoController({
          videoPlayer: elements.videoPlayer,
          videoList: elements.videoList,
          homeVideoGrid: elements.homeVideoGrid,
          titleEl: elements.titleEl,
          onResetSeekBar: () => playerUi.resetSeekBar(),
          onLoadSideData: (videoId) => {
            videoDataController.loadCurrentVideoSideData(videoId);
          },
          onRenderHomeVideos: (videos) => {
            homeVideoBrowser.setVideos(videos);
            homeVideoBrowser.render();
          },
          onPrefetchHomeInfos: () => homeVideoBrowser.prefetch(),
        });

        function initializeDataLoadingAndPlaybackState() {
          playerUi.updateSmoothSeekLoopState();
          localVideoController.loadLocalVideos();
        }

        function initializePlayerPageRuntime() {
          descriptionController.initialize();
          chatHeightController.initialize();
          playerUi.initialize();
          initializeDataLoadingAndPlaybackState();
        }

        initializePlayerPageRuntime();
        window.refreshLocalVideos = () => localVideoController.loadLocalVideos();
      }

      function getPlayerPageElements() {
        return {
          desc: document.getElementById("video-description"),
          toggleBtn: document.getElementById("desc-toggle"),
          videoPlayer: document.getElementById("local-player"),
          videoList: document.getElementById("local-video-list"),
          homeVideoGrid: document.querySelector(".home-video-grid"),
          homeSearchInput: document.getElementById("home-search-input"),
          homeFilterBtn: document.getElementById("home-filter-btn"),
          homeFilterPanel: document.getElementById("home-filter-panel"),
          filterDateFrom: document.getElementById("filter-date-from"),
          filterDateFromText: document.getElementById("filter-date-from-text"),
          filterDateTo: document.getElementById("filter-date-to"),
          filterDateToText: document.getElementById("filter-date-to-text"),
          filterDurationRange: document.getElementById("filter-duration-range"),
          filterDurationMin: document.getElementById("filter-duration-min"),
          filterDurationMax: document.getElementById("filter-duration-max"),
          filterChannel: document.getElementById("filter-channel"),
          filterClearBtn: document.getElementById("filter-clear-btn"),
          titleEl: document.getElementById("player-title"),
          seekBar: document.getElementById("seek-bar"),
          btnPlay: document.getElementById("btn-play"),
          btnFull: document.getElementById("btn-full"),
          timeDisplay: document.getElementById("time-display"),
          playerMain: document.querySelector(".player-main"),
          chatSection: document.getElementById("chat-section"),
          chatContent: document.getElementById("live-chat-container"),
        };
      }

      function createDescriptionController(desc, toggleBtn) {
        function updateDescButton() {
          if (!desc || !toggleBtn) return;
          if (desc.scrollHeight <= desc.clientHeight) {
            toggleBtn.style.display = "none";
          } else {
            toggleBtn.style.display = "inline";
          }
        }

        function initializeDescriptionController() {
          if (!desc || !toggleBtn) return;
          updateDescButton();
          window.addEventListener("resize", updateDescButton);
          toggleBtn.addEventListener("click", () => {
            desc.classList.toggle("collapsed");
            toggleBtn.textContent = desc.classList.contains("collapsed")
              ? "もっと見る"
              : "折りたたむ";
          });
        }

        return {
          updateDescButton,
          initialize: initializeDescriptionController,
        };
      }

      function createChatHeightController(playerMain, chatSection, chatContent) {
        function sync() {
          if (!playerMain || !chatSection || !chatContent) return;

          if (chatSection.classList.contains("collapsed")) {
            chatContent.style.height = "0px";
            chatContent.style.overflow = "hidden";
            return;
          }

          chatContent.style.height = "";
          chatContent.style.overflow = "auto";
        }

        function initializeChatHeightController() {
          setTimeout(sync, 100);
          window.addEventListener("resize", sync);
        }

        return {
          sync,
          initialize: initializeChatHeightController,
        };
      }

      function createPlayerFullscreenToggleHandler(videoPlayer) {
        return async function toggleFullscreen() {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
            return;
          }
          try {
            await videoPlayer.requestFullscreen();
          } catch (_e) {
            await document.getElementById("player-container")?.requestFullscreen();
          }
        };
      }

      document.addEventListener("DOMContentLoaded", () => {
        initializeSettingsAndSse();
        initializeHeaderRouting();
        initializePlayerPage();
      });

      document.addEventListener("job_completed", () => {
        window.refreshLocalVideos?.();
      });

