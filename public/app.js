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

      function createCommentRenderer(linkify) {
        const defaultCommentAvatar =
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='20' r='12' fill='%23999'/%3E%3Cpath d='M12 56c2-14 38-14 40 0' fill='%23ccc'/%3E%3C/svg%3E";

        function normalizeCommentItem(comment) {
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

        function extractRenderableComments(info) {
          const raw = info.comments || info.comment_threads || [];
          return raw
            .map((comment) => normalizeCommentItem(comment))
            .filter((comment) => comment.text && comment.text.trim() !== "");
        }

        function buildCommentTree(comments) {
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

        function createCommentAvatarLink(comment) {
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

        function createCommentMeta(comment) {
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

        function createCommentActions(comment) {
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

        function createCommentElement(comment, isReply) {
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

          body.appendChild(createCommentMeta(comment));
          body.appendChild(text);
          body.appendChild(moreBtn);
          body.appendChild(createCommentActions(comment));

          item.appendChild(createCommentAvatarLink(comment));
          item.appendChild(body);

          attachCommentExpandBehavior(text, moreBtn);
          return item;
        }

        function renderNestedReplyTree(nodes, container) {
          nodes.forEach((node) => {
            const replyEl = createCommentElement(node, true);
            container.appendChild(replyEl);

            if (node.children.length > 0) {
              const nested = document.createElement("div");
              nested.className = "comment-replies";
              renderNestedReplyTree(node.children, nested);
              replyEl.querySelector(".comment-body").appendChild(nested);
            }
          });
        }

        function createReplyControls(parentNode, parentEl) {
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

          renderNestedReplyTree(parentNode.children, replyContainer);
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

          const roots = buildCommentTree(comments);
          roots.forEach((parentNode) => {
            const parentEl = createCommentElement(parentNode, false);
            parentEl.querySelector(".comment-text")?.classList.add("clamped");
            list.appendChild(parentEl);

            if (parentNode.children.length > 0) {
              createReplyControls(parentNode, parentEl);
            }
          });
        }

        return {
          extractRenderableComments,
          renderComments,
        };
      }

      // --- Main Logic ---
      function initializeSettingsAndSse() {
        function saveSetting(key, value) {
          try {
            localStorage.setItem(key, value);
          } catch (e) {
            console.warn("localStorage 保存失敗:", e);
          }
        }

        function loadSetting(key, defaultValue) {
          try {
            const storedValue = localStorage.getItem(key);
            if (storedValue === null) return defaultValue;
            if (typeof defaultValue === "boolean")
              return storedValue === "true";
            return storedValue;
          } catch (e) {
            console.warn("localStorage 読み込み失敗:", e);
            return defaultValue;
          }
        }

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
        let currentWallpaperUrl = null;

        // Load general settings from localStorage
        elements.fmt.value = loadSetting("fmt", elements.fmt.value);
        elements.savePath.value = loadSetting("savePath", "");
        elements.optHistory.checked = loadSetting("optHistory", true);
        elements.optThumb.checked = loadSetting("optThumb", true);
        elements.optDrm.checked = loadSetting("optDrm", false);
        const loadedParallel = loadSetting("optParallelDownloads", "3");
        elements.optParallelDownloads.value = loadedParallel;
        elements.parallelDownloadsValue.textContent = loadedParallel;
        const loadedFragments = loadSetting("optConcurrentFragments", "4");
        elements.optConcurrentFragments.value = loadedFragments;
        elements.concurrentFragmentsValue.textContent = loadedFragments;
        elements.commentOptions.value = loadSetting(
          "commentOptions",
          elements.commentOptions.value,
        );

        // Event listeners for general settings
        elements.fmt.addEventListener("change", (e) =>
          saveSetting("fmt", e.target.value),
        );
        elements.savePath.addEventListener("input", (e) =>
          saveSetting("savePath", e.target.value),
        );
        elements.optHistory.addEventListener("change", (e) =>
          saveSetting("optHistory", e.target.checked),
        );
        elements.optThumb.addEventListener("change", (e) =>
          saveSetting("optThumb", e.target.checked),
        );
        elements.optDrm.addEventListener("change", (e) =>
          saveSetting("optDrm", e.target.checked),
        );
        elements.optParallelDownloads.addEventListener("input", (e) => {
          elements.parallelDownloadsValue.textContent = e.target.value;
          saveSetting("optParallelDownloads", e.target.value);
        });
        elements.optConcurrentFragments.addEventListener("input", (e) => {
          elements.concurrentFragmentsValue.textContent = e.target.value;
          saveSetting("optConcurrentFragments", e.target.value);
        });
        elements.commentOptions.addEventListener("change", (e) =>
          saveSetting("commentOptions", e.target.value),
        );

        // --- History Clear Button ---
        elements.clearHistoryBtn.addEventListener("click", async () => {
          if (!confirm("ダウンロード履歴を削除しますか？")) return;
          try {
            const response = await fetch("/api/clear-history", {
              method: "POST",
            });
            const result = await parseApiResponse(response);
            if (!result.ok) throw new Error(result.error || "履歴の削除に失敗しました。");
            alert(result.data?.message || "履歴を削除しました。");
          } catch (error) {
            console.error("履歴削除エラー:", error);
            alert("履歴の削除に失敗しました。");
          }
        });

        // --- Auto-start Task Buttons ---
        const btnCreateAutostart = document.getElementById('btn-create-autostart-task');
        const btnDeleteAutostart = document.getElementById('btn-delete-autostart-task');
        const autostartStatus = document.getElementById('autostart-status');

        async function handleAutostart(endpoint) {
          try {
            autostartStatus.textContent = '処理中...';
            autostartStatus.style.color = 'var(--blue)';
            const response = await fetch(endpoint, { method: 'POST' });
            const result = await parseApiResponse(response);

            if (result.ok) {
              autostartStatus.textContent = result.data?.message || "完了しました。";
              autostartStatus.style.color = 'var(--green)';
            } else {
              autostartStatus.textContent = `エラー: ${result.error || "処理に失敗しました。"}`;
              autostartStatus.style.color = 'var(--accent)';
            }
          } catch (error) {
            console.error('自動起動タスク操作エラー:', error);
            autostartStatus.textContent = '通信エラーが発生しました。';
            autostartStatus.style.color = 'var(--accent)';
          }
        }

        btnCreateAutostart.addEventListener('click', () => {
            if (confirm('PC起動時にこのアプリケーションを自動で起動するように設定しますか？')) {
                handleAutostart('/api/schedule/create');
            }
        });

        btnDeleteAutostart.addEventListener('click', () => {
            if (confirm('PC起動時の自動実行を解除しますか？')) {
                handleAutostart('/api/schedule/delete');
            }
        });


        // New YouTube Channel Playlist URL Converter
        const youtubeChannelUrlInput = document.getElementById(
          "youtubeChannelUrlInput",
        );
        const youtubePlaylistUrlOutput = document.getElementById(
          "youtubePlaylistUrlOutput",
        );
        const copyPlaylistUrlBtn =
          document.getElementById("copyPlaylistUrlBtn");
        const channelUrlError = document.getElementById("channelUrlError");

        let resolveTimeout;

        youtubeChannelUrlInput.addEventListener("input", () => {
          clearTimeout(resolveTimeout);
          const channelUrl = youtubeChannelUrlInput.value.trim();

          const channelRegex =
            /^https?:\/\/(www\.)?youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})$/;
          const handleRegex =
            /^https?:\/\/(www\.)?youtube\.com\/@([a-zA-Z0-9._-]+)$/;

          const channelMatch = channelUrl.match(channelRegex);
          const handleMatch = channelUrl.match(handleRegex);

          youtubePlaylistUrlOutput.value = ""; // Clear previous output
          channelUrlError.textContent = ""; // Clear previous error

          if (channelUrl === "") {
            return;
          }

          if (channelMatch) {
            const channelId = channelMatch[1]; // UCxxxxxxxxxxx
            const playlistId = channelId.substring(2);
            const playlistUrl = `https://www.youtube.com/playlist?list=UUMO${playlistId}`;
            youtubePlaylistUrlOutput.value = playlistUrl;
          } else if (handleMatch) {
            channelUrlError.textContent = "ハンドルを解決中..."; // Loading indicator
            // Debounce the fetch request
            resolveTimeout = setTimeout(async () => {
              try {
                const response = await fetch("/api/resolve-handle", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({ url: channelUrl }),
                });

                const result = await parseApiResponse(response);

                if (result.ok) {
                  const channelId = result.data?.channelId;
                  if (!channelId) {
                    throw new Error("チャンネルIDの取得に失敗しました。");
                  }
                  const playlistId = channelId.substring(2);
                  const playlistUrl = `https://www.youtube.com/playlist?list=UUMO${playlistId}`;
                  youtubePlaylistUrlOutput.value = playlistUrl;
                  channelUrlError.textContent = ""; // Clear loading message
                } else {
                  channelUrlError.textContent = `エラー: ${result.error || "チャンネルIDの取得に失敗しました。"}`;
                }
              } catch (error) {
                channelUrlError.textContent =
                  "ネットワークエラーまたはサーバーの問題が発生しました。";
                console.error("Error resolving handle:", error);
              }
            }, 500); // 500ms delay
          } else {
            channelUrlError.textContent =
              "無効なYouTubeチャンネルURLまたはハンドルURLです。";
          }
        });

        copyPlaylistUrlBtn.addEventListener("click", async () => {
          const playlistUrl = youtubePlaylistUrlOutput.value;
          if (playlistUrl) {
            try {
              await navigator.clipboard.writeText(playlistUrl);
              alert("再生リストURLをコピーしました！");
            } catch (err) {
              console.error("Failed to copy: ", err);
              alert("コピーに失敗しました。手動でコピーしてください。");
            }
          } else {
            alert("変換された再生リストURLがありません。");
          }
        });

        // --- Cookie Settings Management ---
        function updateCookieButtonStyles(activeButton) {
          elements.setFirefoxBtn.style.background = "#333";
          elements.manualSelectBtn.style.background = "#333";
          elements.noneSelectBtn.style.background = "#333";
          if (activeButton) {
            activeButton.style.background = "var(--blue)"; // Active color
          }
        }

        function applyWallpaperStyle(url, blurPx, brightnessPercent) {
          if (typeof url !== "undefined") {
            currentWallpaperUrl = url || null;
          }
          const safeBlur = Number.isFinite(Number(blurPx))
            ? Math.max(0, Math.min(30, Number(blurPx)))
            : 0;
          const safeBrightness = Number.isFinite(Number(brightnessPercent))
            ? Math.max(30, Math.min(200, Number(brightnessPercent)))
            : 100;
          document.documentElement.style.setProperty(
            "--wallpaper-url",
            currentWallpaperUrl ? `url("${currentWallpaperUrl}")` : "none",
          );
          document.documentElement.style.setProperty(
            "--wallpaper-blur",
            `${safeBlur}px`,
          );
          document.documentElement.style.setProperty(
            "--wallpaper-brightness",
            `${safeBrightness}%`,
          );
          elements.wallpaperBlurRange.value = String(safeBlur);
          elements.wallpaperBlurValue.textContent = `${safeBlur} px`;
          elements.wallpaperBrightnessRange.value = String(safeBrightness);
          elements.wallpaperBrightnessValue.textContent = `${safeBrightness} %`;
        }

        async function loadWallpaperMeta() {
          try {
            const response = await fetch("/api/wallpaper-meta");
            const result = await parseApiResponse(response);
            if (!result.ok) return null;
            const data = result.data || {};
            applyWallpaperStyle(
              data.url || null,
              data.wallpaperBlur ?? 2,
              data.wallpaperBrightness ?? 50,
            );
            elements.wallpaperStatus.textContent = data.exists
              ? "壁紙を設定済み"
              : "壁紙は未設定です";
            return data;
          } catch (error) {
            console.error("壁紙情報の取得に失敗:", error);
            elements.wallpaperStatus.textContent = "壁紙情報の取得に失敗しました";
            return null;
          }
        }

        async function loadServerSettings() {
          try {
            const response = await fetch("/api/settings");
            const result = await parseApiResponse(response);
            if (!result.ok) return null;
            const settings = result.data || {};

            if (settings.selectedBrowser === "firefox") {
              elements.cookieStatusDisplay.textContent = "自動連携: Firefox";
              updateCookieButtonStyles(elements.setFirefoxBtn);
            } else {
              elements.cookieStatusDisplay.textContent = "設定されていません";
              updateCookieButtonStyles(null);
            }

            const dirs = Array.isArray(settings.localVideoDirs)
              ? settings.localVideoDirs
              : [];
            elements.localVideoDirsInput.value = dirs.join("\n");
            elements.localVideoDirsStatus.textContent =
              dirs.length > 0
                ? `${dirs.length} 件のフォルダーを登録中`
                : "追加フォルダーは未設定です";

            const fallbackEnabled =
              settings.enableFallbackThumbnails !== false;
            elements.optFallbackThumbnails.checked = fallbackEnabled;
            const blurValue = Number.isFinite(Number(settings.wallpaperBlur))
              ? Number(settings.wallpaperBlur)
              : 0;
            const brightnessValue = Number.isFinite(
              Number(settings.wallpaperBrightness),
            )
              ? Number(settings.wallpaperBrightness)
              : 100;
            applyWallpaperStyle(null, blurValue, brightnessValue);
            return settings;
          } catch (error) {
            console.error("Failed to load settings:", error);
            return null;
          }
        }

        loadServerSettings().then(() => loadWallpaperMeta());

        async function postSettings(payload) {
          const response = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          return parseApiResponse(response);
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

        // Event listener for Firefox button
        elements.setFirefoxBtn.addEventListener("click", async () => {
          window.selectedCookieFile = null; // Clear manual selection
          try {
            const result = await postSettings({ browser: "firefox" });
            if (result.ok) {
              console.log("設定を Firefox にセットしました。");
              elements.cookieStatusDisplay.textContent = "自動連携: Firefox";
              updateCookieButtonStyles(elements.setFirefoxBtn);
            } else {
              console.error("Firefox設定の保存に失敗しました。");
            }
          } catch (error) {
            console.error("ネットワークエラー:", error);
          }
        });

        // Event listener for Manual Select button
        elements.manualSelectBtn.addEventListener("click", () => {
          elements.cookiePathSet.click();
        });

        // Event listener for file input change
        elements.cookiePathSet.addEventListener("change", async (e) => {
          const file = e.target.files[0];
          if (!file) return;

          window.selectedCookieFile = file;
          // Deactivate browser setting by saving an empty value
          try {
            const result = await postSettings({ browser: "" });
            if (result.ok) {
              console.log(
                "手動ファイル選択のため、ブラウザ自動連携を解除しました。",
              );
              elements.cookieStatusDisplay.textContent = `手動指定: ${file.name}`;
              updateCookieButtonStyles(elements.manualSelectBtn);
            } else {
              console.error("ブラウザ設定のリセットに失敗しました。");
            }
          } catch (error) {
            console.error("ネットワークエラー:", error);
          }
        });

        // Event listener for None button
        elements.noneSelectBtn.addEventListener("click", async () => {
          window.selectedCookieFile = null; // Clear manual selection
          try {
            const result = await postSettings({ browser: "" });
            if (result.ok) {
              console.log("Cookieファイルの使用を解除しました。");
              elements.cookieStatusDisplay.textContent = "設定されていません";
              updateCookieButtonStyles(elements.noneSelectBtn);
            } else {
              console.error("Cookie設定のリセットに失敗しました。");
            }
          } catch (error) {
            console.error("ネットワークエラー:", error);
          }
        });

        elements.wallpaperSelectBtn.addEventListener("click", () => {
          elements.wallpaperFileInput.click();
        });

        elements.wallpaperClearBtn.addEventListener("click", async () => {
          try {
            const response = await fetch("/api/wallpaper/clear", {
              method: "POST",
            });
            const result = await parseApiResponse(response);
            if (!result.ok) {
              throw new Error(result.error || "壁紙のクリアに失敗しました。");
            }

            applyWallpaperStyle(
              null,
              Number(elements.wallpaperBlurRange.value),
              Number(elements.wallpaperBrightnessRange.value),
            );
            elements.wallpaperStatus.textContent = "壁紙をクリアしました。";
          } catch (error) {
            console.error("壁紙クリアエラー:", error);
            elements.wallpaperStatus.textContent = "壁紙のクリアに失敗しました。";
          }
        });

        elements.wallpaperFileInput.addEventListener("change", async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          try {
            const formData = new FormData();
            formData.append("wallpaper", file);
            formData.append("wallpaperBlur", elements.wallpaperBlurRange.value);
            formData.append(
              "wallpaperBrightness",
              elements.wallpaperBrightnessRange.value,
            );

            const response = await fetch("/api/wallpaper", {
              method: "POST",
              body: formData,
            });

            const result = await parseApiResponse(response);
            if (!result.ok) {
              throw new Error(result.error || "壁紙の保存に失敗しました。");
            }

            applyWallpaperStyle(
              result.data?.url || null,
              result.data?.wallpaperBlur ?? 2,
              result.data?.wallpaperBrightness ?? 50,
            );
            elements.wallpaperStatus.textContent = `壁紙を保存しました: ${file.name}`;
          } catch (error) {
            console.error("壁紙の保存エラー:", error);
            elements.wallpaperStatus.textContent =
              "壁紙の保存に失敗しました。画像形式を確認してください。";
          } finally {
            elements.wallpaperFileInput.value = "";
          }
        });

        elements.wallpaperBlurRange.addEventListener("input", (e) => {
          applyWallpaperStyle(
            currentWallpaperUrl,
            Number(e.target.value),
            Number(elements.wallpaperBrightnessRange.value),
          );
        });

        elements.wallpaperBlurRange.addEventListener("change", async (e) => {
          const blurValue = Number(e.target.value);
          try {
            const result = await postSettings({ wallpaperBlur: blurValue });
            if (!result.ok) throw new Error("壁紙Blurの保存に失敗しました。");
            elements.wallpaperStatus.textContent =
              "Blur設定を保存しました。";
            await loadWallpaperMeta();
          } catch (error) {
            console.error("壁紙Blur設定の保存エラー:", error);
            elements.wallpaperStatus.textContent =
              "Blur設定の保存に失敗しました。";
          }
        });

        elements.wallpaperBrightnessRange.addEventListener("input", (e) => {
          applyWallpaperStyle(
            currentWallpaperUrl,
            Number(elements.wallpaperBlurRange.value),
            Number(e.target.value),
          );
        });

        elements.wallpaperBrightnessRange.addEventListener("change", async (e) => {
          const brightnessValue = Number(e.target.value);
          try {
            const result = await postSettings({
              wallpaperBrightness: brightnessValue,
            });
            if (!result.ok) throw new Error("壁紙Brightnessの保存に失敗しました。");
            elements.wallpaperStatus.textContent =
              "Brightness設定を保存しました。";
            await loadWallpaperMeta();
          } catch (error) {
            console.error("壁紙Brightness設定の保存エラー:", error);
            elements.wallpaperStatus.textContent =
              "Brightness設定の保存に失敗しました。";
          }
        });

        elements.saveLocalVideoDirsBtn.addEventListener("click", async () => {
          const inputDirs = normalizeDirListForUi(
            elements.localVideoDirsInput.value.split("\n"),
          );

          try {
            const result = await postSettings({ localVideoDirs: inputDirs });
            const savedDirs = Array.isArray(result.data?.settings?.localVideoDirs)
              ? result.data.settings.localVideoDirs
              : null;
            const saved = result.ok && Array.isArray(savedDirs);

            if (!saved) {
              const refreshed = await loadServerSettings();
              const refreshedDirs = Array.isArray(refreshed?.localVideoDirs)
                ? refreshed.localVideoDirs
                : [];
              const recovered = refreshed && Array.isArray(refreshedDirs);
              if (!recovered) {
                throw new Error(
                  `フォルダー設定の保存に失敗しました (status: ${result.status})`,
                );
              }
            }

            const appliedDirs = Array.isArray(savedDirs) ? savedDirs : inputDirs;
            elements.localVideoDirsStatus.textContent =
              appliedDirs.length > 0
                ? `${appliedDirs.length} 件のフォルダーを登録しました`
                : "追加フォルダーをクリアしました";

            await loadLocalVideos();
          } catch (error) {
            console.error("ローカル動画フォルダー設定の保存に失敗:", error);
            const refreshed = await loadServerSettings();
            const refreshedDirs = normalizeDirListForUi(
              refreshed?.localVideoDirs || [],
            );
            const recovered =
              refreshedDirs.length === inputDirs.length &&
              refreshedDirs.every((v, i) => v === inputDirs[i]);

            if (recovered) {
              elements.localVideoDirsStatus.textContent =
                refreshedDirs.length > 0
                  ? `${refreshedDirs.length} 件のフォルダーを登録しました`
                  : "追加フォルダーをクリアしました";
              await loadLocalVideos();
              return;
            }

            elements.localVideoDirsStatus.textContent =
              "保存に失敗しました。パスを確認して再試行してください。";
          }
        });

        elements.optFallbackThumbnails.addEventListener("change", async (e) => {
          const enabled = e.target.checked;
          try {
            const result = await postSettings({
              enableFallbackThumbnails: enabled,
            });
            const savedValue = result.data?.settings?.enableFallbackThumbnails;
            const saved = result.ok && savedValue === enabled;
            if (!saved) {
              const refreshed = await loadServerSettings();
              const recovered =
                refreshed?.enableFallbackThumbnails === enabled;
              if (!recovered) {
                throw new Error(
                  `仮サムネイル設定の保存に失敗しました (status: ${result.status})`,
                );
              }
            }

            await loadLocalVideos();
          } catch (error) {
            console.error("仮サムネイル設定の保存に失敗:", error);
            const refreshed = await loadServerSettings();
            if (!refreshed) {
              elements.optFallbackThumbnails.checked = !enabled;
            }
          }
        });

        // ===== 5秒移動平均用バッファ =====
        const netBuffer = []; // Mbps 用
        const latencyBuffer = []; // ms 用
        const AVG_WINDOW = 5; // 5秒平均

        function updateJobCounts() {
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
          const completionRate =
            total > 0 ? Math.round((completed / total) * 100) : 0;

          // --- 件数表示 ---
          const totalEl = document.getElementById("info-total-count");
          const completedEl = document.getElementById("info-completed-count");
          const runningEl = document.getElementById("info-running-count");
          const errorEl = document.getElementById("info-error-count");

          if (totalEl) totalEl.textContent = `${total} 件`;
          if (completedEl) completedEl.textContent = `${completed} 件`;
          if (runningEl) runningEl.textContent = `${running} 件`;
          if (errorEl) errorEl.textContent = `${error} 件`;

          // 完了率バー
          const bar = document.getElementById("completion-bar");
          const text = document.getElementById("completion-text");

          if (bar) bar.style.width = `${completionRate}%`;
          if (text) text.textContent = `${completionRate}%`;
        }

        function updateServerClockDisplay(serverTime) {
          if (!serverTime) return;
          const clockEl = document.getElementById("info-clock");
          if (!clockEl) return;
          clockEl.textContent =
            `${serverTime.yyyy}/${serverTime.MM}/${serverTime.dd} ` +
            `${serverTime.hh}:${serverTime.mm}:${serverTime.ss}`;
        }

        function updateNetworkAndLatencyDisplay(data) {
          const netEl = document.getElementById("info-network");
          if (netEl && data.network_mbps != null) {
            netEl.textContent = `${data.network_mbps} Mbps (推定)`;
          }

          const latEl = document.getElementById("info-latency");
          if (latEl && data.latency_ms != null) {
            latEl.textContent = `${data.latency_ms} ms`;
          }
        }

        function updateUptimeDisplay(uptimeSec) {
          const upEl = document.getElementById("info-uptime");
          if (!upEl || typeof uptimeSec !== "number") return;

          const h = Math.floor(uptimeSec / 3600);
          const m = Math.floor((uptimeSec % 3600) / 60);
          const s = uptimeSec % 60;
          upEl.textContent = `${h}時間 ${m}分 ${s}秒`;
        }

        function pushAveragedNetworkSample(mbps, latencyMs) {
          if (mbps == null || latencyMs == null) return;

          netBuffer.push(mbps);
          latencyBuffer.push(latencyMs);
          if (netBuffer.length > AVG_WINDOW) netBuffer.shift();
          if (latencyBuffer.length > AVG_WINDOW) latencyBuffer.shift();

          const avgMbps = Math.round(
            netBuffer.reduce((a, b) => a + b, 0) / netBuffer.length,
          );
          const avgLatency = Math.round(
            latencyBuffer.reduce((a, b) => a + b, 0) / latencyBuffer.length,
          );

          const now = new Date();
          const timeLabel = `${now.getMinutes()}:${now.getSeconds().toString().padStart(2, "0")}`;

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

        // --- SSE Connection ---
        const eventSource = new EventSource("/events");

        // ===== ネットワークグラフの初期化 =====
        const ctx = document.getElementById("networkChart").getContext("2d");

        const networkChart = new Chart(ctx, {
          type: "line",
          data: {
            labels: [], // 時間軸（秒）
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

        eventSource.addEventListener("initial_state", (e) => {
          const jobs = JSON.parse(e.data);
          elements.jobQueue.innerHTML = "";
          const frag = document.createDocumentFragment();
          jobs.forEach((job) => {
            frag.appendChild(renderJob(job));
          });
          elements.jobQueue.appendChild(frag);
          updateJobCounts();
        });

        eventSource.addEventListener("jobs_added", (e) => {
          const newJobs = JSON.parse(e.data);
          const frag = document.createDocumentFragment();
          newJobs.forEach((job) => {
            frag.appendChild(renderJob(job));
          });
          elements.jobQueue.appendChild(frag);
          updateJobCounts();
        });

        eventSource.addEventListener("title_update", (e) => {
          const { id, title } = JSON.parse(e.data);
          const job = jobStates.get(id);
          if (job) {
            job.title = title;
            updateJobElement(job);
          }
        });

        eventSource.addEventListener("progress_update", (e) => {
          const { id, progress } = JSON.parse(e.data);
          const job = jobStates.get(id);
          if (job) {
            job.progress = progress;
            updateJobElement(job);
          }
        });

        eventSource.addEventListener("status_update", (e) => {
          const { id, status, progress, error } = JSON.parse(e.data);
          const job = jobStates.get(id);
          if (job) {
            job.status = status;
            if (progress) job.progress = progress;
            if (error) job.error = error;
            updateJobElement(job);
            updateJobCounts();
          }
        });

        eventSource.onerror = (err) => {
          console.error("EventSource failed:", err);
          const jobQueueDiv = document.getElementById("job-queue");
          jobQueueDiv.innerHTML =
            '<div class="status-warn-text">サーバーとの接続が切れました。起動.batが正常に動作しているか確認してください。</div>' +
            jobQueueDiv.innerHTML;
          eventSource.close();
        };

        eventSource.addEventListener("system_info", (e) => {
          const data = JSON.parse(e.data);
          updateServerClockDisplay(data.server_time);
          updateNetworkAndLatencyDisplay(data);
          updateUptimeDisplay(data.uptime_sec);
          pushAveragedNetworkSample(data.network_mbps, data.latency_ms);
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
        function linkify(text) {
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

        const desc = document.getElementById("video-description");
        const toggleBtn = document.getElementById("desc-toggle");

        function updateDescButton() {
          if (!desc || !toggleBtn) return;
          if (desc.scrollHeight <= desc.clientHeight) {
            toggleBtn.style.display = "none";
          } else {
            toggleBtn.style.display = "inline";
          }
        }

        function initializeDescriptionToggle() {
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

        const videoPlayer = document.getElementById("local-player");
        const videoList = document.getElementById("local-video-list");
        const homeVideoGrid = document.querySelector(".home-video-grid");
        const homeSearchInput = document.getElementById("home-search-input");
        const homeFilterBtn = document.getElementById("home-filter-btn");
        const homeFilterPanel = document.getElementById("home-filter-panel");
        const filterDateFrom = document.getElementById("filter-date-from");
        const filterDateFromText = document.getElementById("filter-date-from-text");
        const filterDateTo = document.getElementById("filter-date-to");
        const filterDateToText = document.getElementById("filter-date-to-text");
        const filterDurationRange = document.getElementById("filter-duration-range");
        const filterDurationMin = document.getElementById("filter-duration-min");
        const filterDurationMax = document.getElementById("filter-duration-max");
        const filterChannel = document.getElementById("filter-channel");
        const filterClearBtn = document.getElementById("filter-clear-btn");
        const titleEl = document.getElementById("player-title");
        let allLocalVideos = [];
        const homeInfoCache = new Map();
        const homeInfoData = new Map();
        let infoAbortController = null;
        let infoRequestToken = 0;
        let chatAbortController = null;
        let chatRequestToken = 0;
        let smoothSeekRafId = null;

        const seekBar = document.getElementById("seek-bar");
        const btnPlay = document.getElementById("btn-play");
        const btnFull = document.getElementById("btn-full");
        const timeDisplay = document.getElementById("time-display");
        seekBar.value = 0;
        seekBar.style.setProperty("--progress", "0%");

        // 再生中はシーク位置を同期
        videoPlayer.addEventListener("timeupdate", () => {
          if (!videoPlayer.duration || isNaN(videoPlayer.duration)) return;
          const progress =
            (videoPlayer.currentTime / videoPlayer.duration) * 100;
          seekBar.value = progress;
          seekBar.style.setProperty("--progress", progress + "%");
        });

        // 再生位置に合わせてライブチャットを同期スクロール
        videoPlayer.addEventListener("timeupdate", () => {
          const chatContainer = document.getElementById("chat-messages");
          if (!chatContainer) return;

          const currentSec = Math.floor(videoPlayer.currentTime);
          const lines = chatContainer.querySelectorAll(".chat-line[data-time]");

          if (lines.length === 0) return;

          let target = null;

          for (const line of lines) {
            const t = parseInt(line.dataset.time, 10);
            if (t <= currentSec) {
              target = line;
            } else {
              break;
            }
          }

          if (!target) return;

          const targetOffset =
            target.offsetTop -
            chatContainer.clientHeight / 2 +
            target.clientHeight / 2;

          chatContainer.scrollTo({
            top: Math.max(0, targetOffset),
            behavior: "smooth",
          });
        });

        function resetSeekBar() {
          seekBar.value = 0;
          seekBar.style.setProperty("--progress", "0%");
        }

        function updateSeekBarFill() {
          const value = seekBar.value;
          seekBar.style.setProperty("--progress", value + "%");
        }

        function initializeSeekBarBindings() {
          seekBar.addEventListener("input", () => {
            if (!videoPlayer.duration) return;
            videoPlayer.currentTime =
              (seekBar.value / 100) * videoPlayer.duration;
            updateSeekBarFill();
          });
          updateSeekBarFill();
        }

        const playerMain = document.querySelector(".player-main");
        const chatSection = document.getElementById("chat-section");
        const chatContent = document.getElementById("live-chat-container");

        function syncChatHeight() {
          if (!playerMain || !chatSection || !chatContent) return;

          if (chatSection.classList.contains("collapsed")) {
            chatContent.style.height = "0px";
            chatContent.style.overflow = "hidden";
            return;
          }

          chatContent.style.height = "";
          chatContent.style.overflow = "auto";
        }

        function initializeChatHeightSync() {
          setTimeout(syncChatHeight, 100);
          window.addEventListener("resize", syncChatHeight);
        }

        function initializePlayButtonBindings() {
          btnPlay.addEventListener("click", () => {
            if (videoPlayer.paused) {
              videoPlayer.play();
            } else {
              videoPlayer.pause();
            }
          });

          videoPlayer.addEventListener("play", () => {
            btnPlay.innerHTML = '<i class="fa-solid fa-pause"></i>';
          });

          videoPlayer.addEventListener("pause", () => {
            btnPlay.innerHTML = '<i class="fa-solid fa-play"></i>';
          });
        }

        function findVideoById(videos, videoId) {
          if (!videoId) return null;

          const normalizedVideoId = String(videoId).trim();

          return videos.find((videoItem) => {
            if (!videoItem || !videoItem.filename) return false;

            const idFromFilename = videoItem.filename.replace(
              /\.(mp4|mkv|webm|mov)$/i,
              "",
            );
            const titleText = String(videoItem.title || "").trim();

            // 旧URL互換: #player/タイトル でも再選択できるようにする
            return (
              idFromFilename === normalizedVideoId ||
              titleText === normalizedVideoId
            );
          });
        }

        function playPendingVideoIfNeeded(videos) {
          if (!pendingVideoId) return;

          const matchedVideo = findVideoById(videos, pendingVideoId);
          if (!matchedVideo) return;

          const matchedItem = Array.from(
            videoList.querySelectorAll(".local-video-item"),
          ).find((item) => item.dataset.filename === matchedVideo.filename);

          playLocalVideo(matchedVideo, matchedItem || null, false);
          pendingVideoId = null;
        }

        function showLocalVideoLoadError() {
          videoList.innerHTML =
            '<div class="status-warn-text">動画一覧の取得に失敗しました</div>';
          if (homeVideoGrid) {
            homeVideoGrid.innerHTML =
              '<div class="home-video-empty status-warn-text">動画一覧の取得に失敗しました</div>';
          }
        }

        function activateLocalVideoItem(activeItem) {
          if (!activeItem) return;
          document
            .querySelectorAll(".local-video-item")
            .forEach((el) => el.classList.remove("active"));
          activeItem.classList.add("active");
        }

        function setupVideoPlayerSource(video) {
          videoPlayer.pause();
          videoPlayer.poster = video.thumb || "";
          videoPlayer.src = video.video;
          lastSelectedFilename = video.filename;

          resetSeekBar();
          videoPlayer.load();
          titleEl.textContent = video.title;
        }

        function tryAutoplayCurrentVideo(shouldAutoplay) {
          const hasUserActivation =
            document.userActivation?.hasBeenActive ||
            document.userActivation?.isActive;

          if (!shouldAutoplay || !hasUserActivation) return;
          videoPlayer.play().catch((err) => {
            if (err?.name !== "NotAllowedError") {
              console.error("Play failed:", err);
            }
          });
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

        function navigateToPlayerFromVideoId(videoId) {
          history.pushState(null, "", "#player/" + encodeURIComponent(videoId));

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

            renderLocalVideos(allLocalVideos);
            renderHomeLocalVideos(allLocalVideos);
            prefetchHomeInfos(allLocalVideos);
            playPendingVideoIfNeeded(allLocalVideos);
          } catch (e) {
            console.error("Failed to load local videos:", e);
            showLocalVideoLoadError();
          }
        }

        function playLocalVideo(video, activeItem = null, shouldAutoplay = true) {
          const videoId = getVideoIdFromFilename(video.filename);
          activateLocalVideoItem(activeItem);
          setupVideoPlayerSource(video);
          tryAutoplayCurrentVideo(shouldAutoplay);
          loadCurrentVideoSideData(videoId);
          navigateToPlayerFromVideoId(videoId);
        }

        function getHomeSearchTerms() {
          const keyword = String(homeSearchInput?.value || "")
            .trim()
            .toLowerCase();
          return keyword.length > 0 ? keyword.split(/\s+/).filter(Boolean) : [];
        }

        function filterHomeVideos(videos, terms) {
          return videos.filter((video) => {
            const source = buildHomeSearchSource(video);
            const keywordMatched =
              terms.length === 0 || terms.every((term) => source.includes(term));
            if (!keywordMatched) return false;
            return matchesAdvancedFilters(video);
          });
        }

        function createHomeVideoCard(video) {
          return createHomeVideoCardElement(video, (selectedVideo) => {
            playLocalVideo(selectedVideo);
          });
        }

        function renderHomeLocalVideos(videos) {
          if (!homeVideoGrid) return;

          homeVideoGrid.innerHTML = "";
          if (videos.length === 0) {
            homeVideoGrid.innerHTML =
              '<div class="home-video-empty">動画が見つかりません</div>';
            return;
          }

          const filteredVideos = filterHomeVideos(videos, getHomeSearchTerms());
          if (filteredVideos.length === 0) {
            homeVideoGrid.innerHTML =
              '<div class="home-video-empty">検索条件に一致する動画がありません</div>';
            return;
          }

          filteredVideos.forEach((video) => {
            const { item, refs } = createHomeVideoCard(video);
            homeVideoGrid.appendChild(item);
            enrichHomeCardInfo(video, refs);
          });
        }

        function getVideoIdFromFilename(filename) {
          return String(filename || "").replace(/\.(mp4|mkv|webm|mov)$/i, "");
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
          const jp =
            h > 0 ? `${h}時間${m}分${s}秒` : `${m}分${s}秒`;

          return [String(total), ms, mmss, hms, jp, `${mOnly}分`];
        }

        function buildHomeSearchSource(video) {
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

          const videoId = getVideoIdFromFilename(video.filename);
          const info = homeInfoData.get(videoId);
          if (info) {
            parts.push(String(info.title || ""));
            parts.push(String(info.channel || ""));
            parts.push(String(info.uploader || ""));
            buildDateVariants(info.upload_date).forEach((v) => parts.push(v));
            buildDurationVariants(info.duration).forEach((v) => parts.push(v));
          }

          return parts.join(" ").toLowerCase();
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

        function getVideoUploadDateForFilter(video, info) {
          const fromInfo = normalizeYyyymmdd(info?.upload_date);
          if (fromInfo) return fromInfo;

          const dt = new Date(Number(video.mtime || 0));
          if (isNaN(dt.getTime())) return "";
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, "0");
          const d = String(dt.getDate()).padStart(2, "0");
          return `${y}${m}${d}`;
        }

        function getHomeFilterState() {
          return {
            channelKeyword: String(filterChannel?.value || "")
              .trim()
              .toLowerCase(),
            fromYmd: normalizeYyyymmdd(
              filterDateFromText?.value || filterDateFrom?.value,
            ),
            toYmd: normalizeYyyymmdd(
              filterDateToText?.value || filterDateTo?.value,
            ),
            durationMode: String(filterDurationRange?.value || "all"),
            durationMinSec: parseDurationInput(filterDurationMin?.value),
            durationMaxSec: parseDurationInput(filterDurationMax?.value),
          };
        }

        function getHomeSearchStateForUrl() {
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

        function applyHomeSearchStateFromUrl() {
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

        function syncHomeSearchStateToUrl() {
          const params = new URLSearchParams(location.search);
          const state = getHomeSearchStateForUrl();

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

        function matchesChannelFilter(info, channelKeyword) {
          if (!channelKeyword) return true;
          const channelSource = `${info?.channel || ""} ${info?.uploader || ""}`.toLowerCase();
          return channelSource.includes(channelKeyword);
        }

        function matchesDateFilter(video, info, fromYmd, toYmd) {
          if (!fromYmd && !toYmd) return true;
          const uploadYmd = getVideoUploadDateForFilter(video, info);
          if (!uploadYmd) return false;

          const uploadNum = Number(uploadYmd);
          if (fromYmd && uploadNum < Number(fromYmd)) return false;
          if (toYmd && uploadNum > Number(toYmd)) return false;
          return true;
        }

        function matchesDurationFilter(info, filterState) {
          const durationMode = filterState.durationMode;
          if (durationMode === "all") return true;

          const durationSec = Number(info?.duration);
          if (!Number.isFinite(durationSec)) return false;

          if (durationMode === "lt3") return durationSec < 180;
          if (durationMode === "3to20")
            return durationSec >= 180 && durationSec < 1200;
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

        function matchesAdvancedFilters(video) {
          const videoId = getVideoIdFromFilename(video.filename);
          const info = homeInfoData.get(videoId) || null;
          const filterState = getHomeFilterState();

          if (!matchesChannelFilter(info, filterState.channelKeyword)) return false;
          if (!matchesDateFilter(video, info, filterState.fromYmd, filterState.toYmd))
            return false;
          return matchesDurationFilter(info, filterState);
        }

        function setDurationCustomInputState() {
          const isCustom = String(filterDurationRange?.value || "all") === "custom";
          if (filterDurationMin) filterDurationMin.disabled = !isCustom;
          if (filterDurationMax) filterDurationMax.disabled = !isCustom;
        }

        function rerenderHomeVideos() {
          renderHomeLocalVideos(allLocalVideos);
        }

        function bindDatePair(dateEl, textEl) {
          if (!dateEl || !textEl) return;

          dateEl?.addEventListener("mousedown", (e) => {
            // 文字列選択ではなくカレンダーピッカーを開く
            e.preventDefault();
            if (typeof dateEl.showPicker === "function") {
              dateEl.showPicker();
            } else {
              dateEl.focus();
            }
          });
          dateEl?.addEventListener("keydown", (e) => {
            // yyyy/mm/dd の直接編集を無効化
            e.preventDefault();
          });

          dateEl?.addEventListener("change", () => {
            textEl.value = dateInputToYyyymmdd(dateEl.value);
            syncHomeSearchStateToUrl();
            rerenderHomeVideos();
          });
          textEl?.addEventListener("input", () => {
            const ymd = normalizeYyyymmdd(textEl.value);
            if (ymd.length === 8) {
              dateEl.value = yyyymmddToDateInput(ymd);
            }
            syncHomeSearchStateToUrl();
            rerenderHomeVideos();
          });
        }

        function clearHomeFilters() {
          if (filterDateFrom) filterDateFrom.value = "";
          if (filterDateFromText) filterDateFromText.value = "";
          if (filterDateTo) filterDateTo.value = "";
          if (filterDateToText) filterDateToText.value = "";
          if (filterDurationRange) filterDurationRange.value = "all";
          if (filterDurationMin) filterDurationMin.value = "";
          if (filterDurationMax) filterDurationMax.value = "";
          if (filterChannel) filterChannel.value = "";
        }

        function bindHomeFilterInputs() {
          filterDurationRange?.addEventListener("change", () => {
            setDurationCustomInputState();
            syncHomeSearchStateToUrl();
            rerenderHomeVideos();
          });
          filterDurationMin?.addEventListener("input", () => {
            syncHomeSearchStateToUrl();
            rerenderHomeVideos();
          });
          filterDurationMax?.addEventListener("input", () => {
            syncHomeSearchStateToUrl();
            rerenderHomeVideos();
          });
          filterChannel?.addEventListener("input", () => {
            syncHomeSearchStateToUrl();
            rerenderHomeVideos();
          });
        }

        function bindHomeFilterEvents() {
          homeFilterBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            homeFilterPanel?.classList.toggle("hidden");
          });

          document.addEventListener("click", (e) => {
            if (!homeFilterPanel || homeFilterPanel.classList.contains("hidden")) return;
            if (homeFilterPanel.contains(e.target) || homeFilterBtn?.contains(e.target)) {
              return;
            }
            homeFilterPanel.classList.add("hidden");
          });

          bindDatePair(filterDateFrom, filterDateFromText);
          bindDatePair(filterDateTo, filterDateToText);
          bindHomeFilterInputs();

          filterClearBtn?.addEventListener("click", () => {
            clearHomeFilters();
            setDurationCustomInputState();
            syncHomeSearchStateToUrl();
            rerenderHomeVideos();
          });

          setDurationCustomInputState();
        }

        function initializeHomeSearchAndFilters() {
          applyHomeSearchStateFromUrl();
          homeSearchInput?.addEventListener("input", () => {
            syncHomeSearchStateToUrl();
            rerenderHomeVideos();
          });
          bindHomeFilterEvents();
          setDurationCustomInputState();
        }

        initializeHomeSearchAndFilters();

        function formatUploadDateText(uploadDate) {
          const d = String(uploadDate || "").replace(/\D/g, "");
          if (d.length !== 8) return "投稿日不明";
          return `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6, 8)}`;
        }

        function formatViewCountText(viewCount) {
          if (typeof viewCount === "number" && Number.isFinite(viewCount)) {
            return `${viewCount.toLocaleString()} 回視聴`;
          }
          return "視聴回数不明";
        }

        async function getHomeInfo(video) {
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

        async function prefetchHomeInfos(videos) {
          const requests = videos.map((video) => getHomeInfo(video));
          await Promise.allSettled(requests);
          rerenderHomeVideos();
        }

        async function enrichHomeCardInfo(video, refs) {
          const info = await getHomeInfo(video);
          if (!info || !refs?.titleEl?.isConnected) return;

          refs.titleEl.textContent = info.title?.trim() || video.title;
          refs.channelEl.textContent = info.channel?.trim() || "ローカル動画";
          refs.statsEl.textContent = `${formatViewCountText(info.view_count)} ・ ${formatUploadDateText(info.upload_date)}`;

          const avatar = info.channel_thumbnail?.trim();
          if (avatar) {
            refs.iconEl.src = avatar;
          }
        }

        async function toggleFullscreen() {
          if (document.fullscreenElement) {
            await document.exitFullscreen();
            return;
          }
          try {
            await videoPlayer.requestFullscreen();
          } catch (_e) {
            await document.getElementById("player-container")?.requestFullscreen();
          }
        }

        function initializeVideoInteraction() {
          let clickTimer = null;
          const DOUBLE_CLICK_DELAY = 250;

          videoPlayer.addEventListener("click", (e) => {
            if (e.target.closest(".yt-controls")) return;

            if (clickTimer) {
              clearTimeout(clickTimer);
              clickTimer = null;
              return;
            }

            clickTimer = setTimeout(() => {
              if (videoPlayer.paused) {
                videoPlayer.play();
              } else {
                videoPlayer.pause();
              }
              clickTimer = null;
            }, DOUBLE_CLICK_DELAY);
          });

          videoPlayer.addEventListener("dblclick", async () => {
            await toggleFullscreen();
            if (clickTimer) {
              clearTimeout(clickTimer);
              clickTimer = null;
            }
          });
        }

        function initializeSpeedMenu() {
          const btnSpeed = document.getElementById("btn-speed");
          const speedMenu = document.getElementById("speed-menu");
          const speedOptions = document.querySelectorAll(".speed-option");
          if (!btnSpeed || !speedMenu) return;

          btnSpeed.addEventListener("click", (e) => {
            e.stopPropagation();
            speedMenu.classList.toggle("hidden");
          });

          speedOptions.forEach((option) => {
            option.addEventListener("click", () => {
              const speed = parseFloat(option.dataset.speed);
              videoPlayer.playbackRate = speed;
              btnSpeed.textContent = speed + "×";
              speedMenu.classList.add("hidden");
            });
          });

          document.addEventListener("click", () => {
            speedMenu.classList.add("hidden");
          });
        }

        function initializeSidebarToggles() {
          document.querySelectorAll(".sidebar-toggle").forEach((btn) => {
            btn.addEventListener("click", () => {
              const targetId = btn.getAttribute("data-target");
              const section = document.getElementById(targetId);
              if (!section) return;

              const content = section.querySelector(".sidebar-content");
              if (!content) return;

              const isCollapsed = content.classList.toggle("collapsed");
              const icon = btn.querySelector("i");
              if (icon) {
                icon.className = isCollapsed
                  ? "fa-solid fa-chevron-right"
                  : "fa-solid fa-chevron-down";
              }

              setTimeout(syncChatHeight, 180);
            });
          });
        }

        function initializeCommentSortMenu() {
          const sortToggle = document.getElementById("sort-toggle");
          const sortMenu = document.getElementById("sort-menu");
          const sortItems = document.querySelectorAll(".sort-item");
          if (!sortToggle || !sortMenu) return;

          sortToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            sortMenu.classList.toggle("hidden");
          });

          document.addEventListener("click", (e) => {
            if (!sortToggle.contains(e.target) && !sortMenu.contains(e.target)) {
              sortMenu.classList.add("hidden");
            }
          });

          sortItems.forEach((item) => {
            item.addEventListener("click", () => {
              const sortType = item.dataset.sort;
              sortItems.forEach((i) => i.classList.remove("active"));
              item.classList.add("active");
              sortMenu.classList.add("hidden");

              if (
                !window.currentVideoComments ||
                window.currentVideoComments.length === 0
              )
                return;

              let sorted = [...window.currentVideoComments];
              if (sortType === "popular") {
                sorted.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
              } else if (sortType === "newest") {
                sorted.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
              }
              commentRenderer.renderComments(sorted);
            });
          });
        }

        function renderChatMessage(message) {
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

        function createChatAvatarElement(renderer, author) {
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

        function createChatBadgeElement(badgeImages) {
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

        function createChatLineElement(msg) {
          const renderer = extractChatRenderer(msg);
          if (!renderer) return null;

          const author = renderer.authorName?.simpleText || "NoName";
          const { isMember, isModerator, badgeImages } = getChatBadgeInfo(renderer);
          const msgHtml =
            renderChatMessage(renderer.message) ||
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

          line.appendChild(createChatAvatarElement(renderer, author));
          line.appendChild(nameEl);
          line.appendChild(createChatBadgeElement(badgeImages));
          line.appendChild(msgEl);
          return line;
        }

        async function loadLiveChat(videoBaseName) {
          chatRequestToken += 1;
          const currentChatToken = chatRequestToken;
          if (chatAbortController) {
            chatAbortController.abort();
          }
          chatAbortController = new AbortController();

          try {
            const chatContainer = document.getElementById("chat-messages");
            const emptyEl =
              document.querySelector("#live-chat-container .chat-empty") ||
              document.querySelector(".chat-empty");

            if (!chatContainer) {
              console.error("chat-messages が見つかりません");
              return;
            }

            chatContainer.innerHTML = "";

            if (emptyEl) {
              emptyEl.style.display = "block";
              emptyEl.textContent = "チャットを読み込み中…";
            }

            const base = normalizeLiveChatBaseName(videoBaseName);
            const res = await fetch(`/api/live-chat/${encodeURIComponent(base)}`, {
              signal: chatAbortController.signal,
            });
            const text = await res.text();
            if (currentChatToken !== chatRequestToken) return;
            const messages = parseNdjsonMessages(text);

            if (messages.length === 0) {
              if (emptyEl) {
                emptyEl.textContent = "チャットがありません";
              }
              return;
            }

            emptyEl.style.display = "none";
            messages.forEach((msg) => {
              const line = createChatLineElement(msg);
              if (line) {
                chatContainer.appendChild(line);
              }
            });
            chatContainer.scrollTop = chatContainer.scrollHeight;
          } catch (e) {
            if (e?.name === "AbortError") return;
            console.error("loadLiveChat error:", e);
            const emptyEl = document.querySelector(".chat-empty");
            if (emptyEl)
              emptyEl.textContent = "チャットの読み込みに失敗しました";
          }
        }

        function createLocalVideoListItem(video) {
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

          item.addEventListener("click", () => {
            playLocalVideo(video, item);
          });

          return item;
        }

        function renderLocalVideos(videos) {
          videoList.innerHTML = "";

          if (videos.length === 0) {
            videoList.innerHTML =
              '<div class="status-subtext">動画が見つかりません</div>';
            return;
          }

          videos.forEach((video) => {
            videoList.appendChild(createLocalVideoListItem(video));
          });
        }

        function formatChannelSubscribers(subCount) {
          if (typeof subCount !== "number") return "登録者数不明";
          if (subCount < 10000) return `${subCount}人`;
          return `${Math.floor(subCount / 1000) / 10}万人`;
        }

        function formatUploadDateForDescription(uploadDate) {
          const value = String(uploadDate || "");
          if (value.length !== 8) return value;
          return `${value.substring(0, 4)}/${value.substring(4, 6)}/${value.substring(6, 8)}`;
        }

        function buildDescriptionHeader(info) {
          const views = info.view_count
            ? `<b>${info.view_count.toLocaleString()}回視聴</b>`
            : "<b>視聴回数不明</b>";
          if (!info.upload_date) return views;
          return `${views} • <b>${formatUploadDateForDescription(info.upload_date)}</b>`;
        }

        function updatePlayerHeaderInfo(info) {
          const titleEl = document.getElementById("player-title");
          const youtubeBtn = document.getElementById("youtube-link-btn");

          if (info.title && info.title.trim() !== "") {
            titleEl.textContent = info.title;
          } else if (lastSelectedFilename) {
            titleEl.textContent = lastSelectedFilename.replace(
              /\.(mp4|mkv|webm|mov)$/i,
              "",
            );
          } else {
            titleEl.textContent = "無題";
          }

          if (info.id) {
            youtubeBtn.href = `https://www.youtube.com/watch?v=${info.id}`;
            youtubeBtn.style.display = "inline-flex";
          } else {
            youtubeBtn.style.display = "none";
          }
        }

        function updateChannelInfo(info) {
          const avatar = document.getElementById("channel-avatar");
          const channelLink = document.getElementById("channel-link");
          const channelHandle = document.getElementById("channel-handle");
          const channelSubs = document.getElementById("channel-subs");
          const avatarLink = document.getElementById("channel-avatar-link");
          if (!avatar || !channelLink || !channelHandle || !channelSubs || !avatarLink)
            return;

          avatar.src = info.channel_thumbnail?.trim() || "/none_icon.jpg";
          avatar.onerror = () => {
            avatar.src = "/none_icon.jpg";
          };

          channelLink.textContent = info.channel;
          channelLink.href = info.channel_url;
          avatarLink.href = info.channel_url;
          channelHandle.textContent = info.uploader_id;
          channelSubs.textContent = `${formatChannelSubscribers(info.channel_follower_count)} 登録`;
        }

        function updateVideoStats(info) {
          const statLikes = document.getElementById("stat-likes");
          if (!statLikes) return;
          statLikes.textContent = info.like_count
            ? info.like_count.toLocaleString()
            : "---";
        }

        function updateVideoDescription(info) {
          const descEl = document.getElementById("video-description");
          if (!descEl) return;
          const descContent = info.description
            ? linkify(info.description)
            : "（概要欄なし）";

          descEl.innerHTML = `${buildDescriptionHeader(info)}<br><br>${descContent}`;
          descEl.classList.add("collapsed");
          updateDescButton();
        }

        function resetCommentDisplay() {
          const list = document.getElementById("comment-list");
          const empty = document.querySelector(".comment-empty");
          if (!list || !empty) return;
          list.innerHTML = "";
          empty.style.display = "none";
        }

        const commentRenderer = createCommentRenderer(linkify);

        function applyVideoInfo(info) {
          updatePlayerHeaderInfo(info);
          updateChannelInfo(info);
          updateVideoStats(info);
          updateVideoDescription(info);
          resetCommentDisplay();

          window.currentVideoComments = commentRenderer.extractRenderableComments(info);
          commentRenderer.renderComments(window.currentVideoComments);
        }

        // XSS対策
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

        // ======== 滑らかなシークバー同期（時間表示は維持） ========

        // 目標値（実際の動画の進捗）
        let targetProgress = 0;

        function formatVideoTime(seconds) {
          const total = Math.max(0, Math.floor(seconds || 0));
          const m = Math.floor(total / 60);
          const s = total % 60;
          return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
        }

        function shouldRunSmoothSeekLoop() {
          const playerPage = document.getElementById("page-player");
          return (
            !document.hidden &&
            !!playerPage &&
            playerPage.classList.contains("active-page")
          );
        }

        function updateSmoothSeekLoopState() {
          if (shouldRunSmoothSeekLoop()) {
            if (smoothSeekRafId === null) {
              smoothSeekRafId = requestAnimationFrame(smoothSeek);
            }
            return;
          }

          if (smoothSeekRafId !== null) {
            cancelAnimationFrame(smoothSeekRafId);
            smoothSeekRafId = null;
          }
        }

        window.updateSmoothSeekLoopState = updateSmoothSeekLoopState;
        document.addEventListener("visibilitychange", updateSmoothSeekLoopState);

        // timeupdate: 時間表示と目標進捗のみ更新
        videoPlayer.addEventListener("timeupdate", () => {
          if (!videoPlayer.duration) return;

          const cur = Math.floor(videoPlayer.currentTime);
          const dur = Math.floor(videoPlayer.duration);

          targetProgress =
            (videoPlayer.currentTime / videoPlayer.duration) * 100;

          timeDisplay.textContent = `${formatVideoTime(cur)} / ${formatVideoTime(dur)}`;
        });

        // requestAnimationFrame: つまみを滑らかに追従
        function smoothSeek() {
          if (!videoPlayer.duration || isNaN(videoPlayer.duration)) {
            targetProgress = 0;
            seekBar.value = 0;
            seekBar.style.setProperty("--progress", "0%");
            smoothSeekRafId = requestAnimationFrame(smoothSeek);
            return;
          }

          const current = parseFloat(seekBar.value) || 0;
          const diff = targetProgress - current;

          const easing = 0.001;
          const newValue = current + diff * easing;

          seekBar.value = newValue;
          seekBar.style.setProperty("--progress", newValue + "%");

          smoothSeekRafId = requestAnimationFrame(smoothSeek);
        }

        updateSmoothSeekLoopState();

        loadLocalVideos();

        function skip(sec) {
          const t = videoPlayer.currentTime + sec;
          videoPlayer.currentTime = Math.max(
            0,
            Math.min(videoPlayer.duration, t),
          );
        }

        function changeVolume(delta) {
          videoPlayer.volume = Math.max(
            0,
            Math.min(1, videoPlayer.volume + delta),
          );
        }

        function togglePlay() {
          if (videoPlayer.paused) {
            videoPlayer.play();
          } else {
            videoPlayer.pause();
          }
        }

        function initializeQuickButtonsAndVolume() {
          const btnRew5 = document.getElementById("btn-rew5");
          const btnFwd5 = document.getElementById("btn-fwd5");
          const volumeBar = document.getElementById("volume-bar");
          const volumeIcon = document.querySelector(".yt-volume i");
          if (!btnRew5 || !btnFwd5 || !volumeBar || !volumeIcon) return;

          let lastVolume = volumeBar.value;

          volumeIcon.addEventListener("click", () => {
            if (videoPlayer.muted) {
              videoPlayer.muted = false;
              videoPlayer.volume = lastVolume || 0.5;
            } else {
              videoPlayer.muted = true;
            }
          });

          btnRew5.addEventListener("click", () => skip(-5));
          btnFwd5.addEventListener("click", () => skip(5));

          volumeBar.addEventListener("input", (e) => {
            const v = Number(e.target.value);
            videoPlayer.volume = v;
            videoPlayer.muted = false;
            lastVolume = v;
          });

          videoPlayer.addEventListener("volumechange", () => {
            if (!videoPlayer.muted) {
              volumeBar.value = videoPlayer.volume;
              lastVolume = videoPlayer.volume;
            }

            if (videoPlayer.muted || videoPlayer.volume === 0) {
              volumeIcon.className = "fa-solid fa-volume-xmark";
            } else if (videoPlayer.volume < 0.5) {
              volumeIcon.className = "fa-solid fa-volume-low";
            } else {
              volumeIcon.className = "fa-solid fa-volume-high";
            }
          });
        }

        function initializeKeyboardShortcuts() {
          document.addEventListener("keydown", (e) => {
            const activeTag = document.activeElement?.tagName;
            if (activeTag === "TEXTAREA" || activeTag === "INPUT") return;

            switch (e.key) {
              case " ":
              case "k":
                e.preventDefault();
                togglePlay();
                break;
              case "j":
                skip(-10);
                break;
              case "l":
                skip(10);
                break;
              case "ArrowLeft":
                skip(-5);
                break;
              case "ArrowRight":
                skip(5);
                break;
              case "ArrowUp":
                changeVolume(0.05);
                break;
              case "ArrowDown":
                changeVolume(-0.05);
                break;
              case "m":
              case "M":
                videoPlayer.muted = !videoPlayer.muted;
                break;
              default:
                if (/^[0-9]$/.test(e.key) && videoPlayer.duration) {
                  const percent = Number(e.key) * 10;
                  videoPlayer.currentTime = (percent / 100) * videoPlayer.duration;
                }
                break;
            }
          });
        }

        function initializeAutoHideControls() {
          const playerContainer = document.getElementById("player-container");
          const ytControls = document.querySelector(".yt-controls");
          if (!playerContainer || !ytControls) return;

          let hideTimer = null;
          const showControls = () => ytControls.classList.add("show");
          const scheduleHide = () => {
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
              ytControls.classList.remove("show");
            }, 2000);
          };

          playerContainer.addEventListener("mouseenter", showControls);
          playerContainer.addEventListener("mousemove", () => {
            showControls();
            scheduleHide();
          });
          playerContainer.addEventListener("mouseleave", () => {
            ytControls.classList.remove("show");
            if (hideTimer) clearTimeout(hideTimer);
          });
        }

        function initializeAppUi() {
          initializeDescriptionToggle();
          initializeSeekBarBindings();
          initializeChatHeightSync();
          initializePlayButtonBindings();
          initializeVideoInteraction();
          initializeSpeedMenu();
          initializeSidebarToggles();
          initializeCommentSortMenu();
          initializeQuickButtonsAndVolume();
          initializeKeyboardShortcuts();
          initializeAutoHideControls();
        }

        btnFull.addEventListener("click", async () => {
          await toggleFullscreen();
        });

        initializeAppUi();
        window.refreshLocalVideos = loadLocalVideos;
      }

      document.addEventListener("DOMContentLoaded", () => {
        initializeSettingsAndSse();
        initializeHeaderRouting();
        initializePlayerPage();
      });

      document.addEventListener("job_completed", () => {
        window.refreshLocalVideos?.();
      });
