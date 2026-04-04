// Player UI module extracted from app.js

function bindPlayButton(videoPlayer, btnPlay) {
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

      function bindVideoClickInteractions(videoPlayer, onToggleFullscreen) {
        let clickTimer = null;
        const DOUBLE_CLICK_DELAY = 250;
        const ytControls = document.querySelector(".yt-controls");
        let controlsHideTimer = null;
        let suppressNextClick = false;

        const isMobileViewport = () =>
          !!window.matchMedia && window.matchMedia("(max-width: 768px)").matches;

        const showControlsTemporarily = () => {
          if (!ytControls) return;
          ytControls.classList.add("show");
          if (controlsHideTimer) clearTimeout(controlsHideTimer);
          controlsHideTimer = setTimeout(() => {
            ytControls.classList.remove("show");
          }, 2000);
        };

        const handleMobileVideoTap = () => {
          const controlsVisible = !!ytControls && ytControls.classList.contains("show");
          showControlsTemporarily();
          if (!controlsVisible) return;
          if (videoPlayer.paused) {
            videoPlayer.play();
          } else {
            videoPlayer.pause();
          }
        };

        videoPlayer.addEventListener(
          "touchend",
          (e) => {
            if (!isMobileViewport()) return;
            if (e.target.closest(".yt-controls")) return;
            e.preventDefault();
            e.stopPropagation();
            suppressNextClick = true;
            handleMobileVideoTap();
          },
          { passive: false },
        );

        videoPlayer.addEventListener("click", (e) => {
          if (e.target.closest(".yt-controls")) return;

          if (isMobileViewport()) {
            if (suppressNextClick) {
              suppressNextClick = false;
              return;
            }
            e.preventDefault();
            e.stopPropagation();
            handleMobileVideoTap();
            return;
          }

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
          if (isMobileViewport()) return;
          await onToggleFullscreen();
          if (clickTimer) {
            clearTimeout(clickTimer);
            clickTimer = null;
          }
        });
      }

      function bindSpeedMenu(videoPlayer) {
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
            btnSpeed.textContent = `${speed}×`;
            speedMenu.classList.add("hidden");
          });
        });

        document.addEventListener("click", () => {
          speedMenu.classList.add("hidden");
        });
      }

      function bindSidebarToggles(onSidebarToggled) {
        document.querySelectorAll(".sidebar-toggle").forEach((btn) => {
          btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-target");
            const section = document.getElementById(targetId);
            if (!section) return;

            const content = section.querySelector(".sidebar-content");
            if (!content) return;

            const isCollapsed = content.classList.toggle("collapsed");
            section.classList.toggle("collapsed", isCollapsed);
            const icon = btn.querySelector("i");
            if (icon) {
              icon.className = isCollapsed
                ? "fa-solid fa-chevron-right"
                : "fa-solid fa-chevron-down";
            }

            setTimeout(onSidebarToggled, 180);
          });
        });
      }

      function hasCommentLineTimestamp(text) {
        if (typeof text !== "string" || text.trim() === "") return false;
        const lineStartTimestampPattern =
          /(^|\n)\s*(?:\d{1,2}:[0-5]\d:[0-5]\d|[0-5]?\d:[0-5]\d)(?=\s|$)/;
        return lineStartTimestampPattern.test(text);
      }

      function createCommentLookupTables(comments) {
        const commentById = new Map();
        const childCountById = new Map();
        comments.forEach((comment) => {
          if (!comment || !comment.id) return;
          commentById.set(comment.id, comment);
          if (comment.parent) {
            const currentCount = childCountById.get(comment.parent) || 0;
            childCountById.set(comment.parent, currentCount + 1);
          }
        });
        return { commentById, childCountById };
      }

      function applyCommentFilters(comments, activeFilters) {
        if (!(activeFilters instanceof Set) || activeFilters.size === 0) {
          return [...comments];
        }

        const { commentById, childCountById } = createCommentLookupTables(comments);
        const includeIds = new Set();

        const isMatchedByAllFilters = (comment) => {
          for (const filterKey of activeFilters) {
            if (filterKey === "timestamp") {
              if (!hasCommentLineTimestamp(comment.text || "")) return false;
              continue;
            }
            if (filterKey === "with-replies") {
              if ((childCountById.get(comment.id) || 0) === 0) return false;
              continue;
            }
            if (filterKey === "favorited") {
              if (comment.is_favorited !== true) return false;
              continue;
            }
            if (filterKey === "pinned") {
              if (comment.is_pinned !== true) return false;
              continue;
            }
          }
          return true;
        };

        comments.forEach((comment) => {
          if (!comment || !comment.id || !isMatchedByAllFilters(comment)) return;

          let current = comment;
          while (current && current.id) {
            if (includeIds.has(current.id)) break;
            includeIds.add(current.id);
            if (!current.parent) break;
            current = commentById.get(current.parent) || null;
          }
        });

        return comments.filter((comment) => comment && includeIds.has(comment.id));
      }

      function sortCommentsByType(comments, sortType) {
        const sorted = [...comments];
        if (sortType === "popular") {
          sorted.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
          return sorted;
        }
        if (sortType === "oldest") {
          sorted.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          return sorted;
        }
        sorted.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return sorted;
      }

      function bindCommentSortMenu(renderSortedComments) {
        const sortToggle = document.getElementById("sort-toggle");
        const sortMenu = document.getElementById("sort-menu");
        const filterToggle = document.getElementById("filter-toggle");
        const filterMenu = document.getElementById("filter-menu");
        const sortItems = document.querySelectorAll(".sort-item");
        const filterItems = document.querySelectorAll(".filter-item");
        if (!sortToggle || !sortMenu) return;

        const state = {
          sortType:
            document.querySelector(".sort-item.active")?.dataset.sort || "newest",
          activeFilters: new Set(
            Array.from(filterItems)
              .filter((item) => item.classList.contains("active"))
              .map((item) => item.dataset.filter),
          ),
        };

        const updateFilterToggleLabel = () => {
          if (!filterToggle) return;
          const activeCount = state.activeFilters.size;
          filterToggle.innerHTML =
            activeCount > 0
              ? `<i class="fa-solid fa-filter"></i> 絞り込み (${activeCount})`
              : '<i class="fa-solid fa-filter"></i> 絞り込み';
        };

        const applyCurrentCommentView = () => {
          const allComments = Array.isArray(window.currentVideoComments)
            ? window.currentVideoComments
            : [];
          const filtered = applyCommentFilters(allComments, state.activeFilters);
          const sorted = sortCommentsByType(filtered, state.sortType);
          renderSortedComments(sorted);
        };

        window.applyCurrentCommentSortAndFilters = applyCurrentCommentView;
        updateFilterToggleLabel();

        sortToggle.addEventListener("click", (e) => {
          e.stopPropagation();
          if (filterMenu) filterMenu.classList.add("hidden");
          sortMenu.classList.toggle("hidden");
        });

        if (filterToggle && filterMenu) {
          filterToggle.addEventListener("click", (e) => {
            e.stopPropagation();
            sortMenu.classList.add("hidden");
            filterMenu.classList.toggle("hidden");
          });
        }

        document.addEventListener("click", (e) => {
          if (!sortToggle.contains(e.target) && !sortMenu.contains(e.target)) {
            sortMenu.classList.add("hidden");
          }
          if (
            filterToggle &&
            filterMenu &&
            !filterToggle.contains(e.target) &&
            !filterMenu.contains(e.target)
          ) {
            filterMenu.classList.add("hidden");
          }
        });

        sortItems.forEach((item) => {
          item.addEventListener("click", () => {
            state.sortType = item.dataset.sort || "newest";
            sortItems.forEach((i) => i.classList.remove("active"));
            item.classList.add("active");
            sortMenu.classList.add("hidden");
            applyCurrentCommentView();
          });
        });

        filterItems.forEach((item) => {
          item.addEventListener("click", () => {
            const filterKey = item.dataset.filter;
            if (!filterKey) return;

            if (state.activeFilters.has(filterKey)) {
              state.activeFilters.delete(filterKey);
              item.classList.remove("active");
            } else {
              state.activeFilters.add(filterKey);
              item.classList.add("active");
            }

            updateFilterToggleLabel();
            applyCurrentCommentView();
          });
        });
      }

      function bindQuickButtonsAndVolume(videoPlayer, skip) {
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

      function bindKeyboardShortcuts(videoPlayer, skip, changeVolume, togglePlay) {
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

      function bindTimestampSeekLinks(videoPlayer) {
        document.addEventListener("click", (event) => {
          const link = event.target.closest("a.timestamp-link");
          if (!link) return;

          event.preventDefault();
          event.stopPropagation();
          const seconds = Number.parseInt(link.dataset.seconds || "", 10);
          if (!Number.isFinite(seconds) || seconds < 0) return;
          const duration = Number(videoPlayer.duration);
          if (Number.isFinite(duration) && duration > 0) {
            videoPlayer.currentTime = Math.min(seconds, duration);
            return;
          }
          videoPlayer.currentTime = seconds;
        });
      }

      function bindAutoHideControls() {
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

      
function syncLiveChatScrollForCurrentTime(videoPlayer) {
        const chatContainer = document.getElementById("chat-messages");
        if (!chatContainer) return;

        const currentSec = Math.floor(videoPlayer.currentTime);
        if (chatContainer.__lastSyncedSecond === currentSec) return;
        chatContainer.__lastSyncedSecond = currentSec;
        const timedLines = Array.isArray(chatContainer.__chatTimedLines)
          ? chatContainer.__chatTimedLines
          : [];
        if (timedLines.length === 0) return;

        let target = null;
        let cursor = Number.isInteger(chatContainer.__chatTimedIndex)
          ? chatContainer.__chatTimedIndex
          : 0;
        cursor = Math.max(0, Math.min(cursor, timedLines.length - 1));

        if (timedLines[cursor]?.timeSec > currentSec) {
          let low = 0;
          let high = cursor;
          while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (timedLines[mid].timeSec <= currentSec) {
              target = timedLines[mid].line;
              cursor = mid;
              low = mid + 1;
            } else {
              high = mid - 1;
            }
          }
        } else {
          while (
            cursor + 1 < timedLines.length &&
            timedLines[cursor + 1].timeSec <= currentSec
          ) {
            cursor += 1;
          }
          target = timedLines[cursor]?.line || null;
        }
        if (!target) return;
        chatContainer.__chatTimedIndex = cursor;

        const targetTime = String(target.dataset.time || "");
        if (chatContainer.__lastChatTargetTime === targetTime) return;
        chatContainer.__lastChatTargetTime = targetTime;

        const targetOffset =
          target.offsetTop - chatContainer.clientHeight / 2 + target.clientHeight / 2;
        chatContainer.scrollTop = Math.max(0, targetOffset);
      }

      function createPlayerPlaybackActions(videoPlayer) {
        function skip(sec) {
          const t = videoPlayer.currentTime + sec;
          videoPlayer.currentTime = Math.max(0, Math.min(videoPlayer.duration, t));
        }

        function changeVolume(delta) {
          videoPlayer.volume = Math.max(0, Math.min(1, videoPlayer.volume + delta));
        }

        function togglePlay() {
          if (videoPlayer.paused) {
            videoPlayer.play();
          } else {
            videoPlayer.pause();
          }
        }

        return { skip, changeVolume, togglePlay };
      }

      function createPlayerSeekSyncController(videoPlayer, seekBar, timeDisplay) {
        let smoothSeekRafId = null;
        let targetProgress = 0;

        function resetSeekBar() {
          seekBar.value = 0;
          seekBar.style.setProperty("--progress", "0%");
        }

        function updateSeekBarFill() {
          const value = seekBar.value;
          seekBar.style.setProperty("--progress", `${value}%`);
        }

        function syncSeekBarWithVideo() {
          if (!videoPlayer.duration || isNaN(videoPlayer.duration)) return;
          const progress = (videoPlayer.currentTime / videoPlayer.duration) * 100;
          seekBar.value = progress;
          seekBar.style.setProperty("--progress", `${progress}%`);
        }

        function syncPlaybackClockWithVideo() {
          if (!videoPlayer.duration) return;
          const cur = Math.floor(videoPlayer.currentTime);
          const dur = Math.floor(videoPlayer.duration);
          targetProgress = (videoPlayer.currentTime / videoPlayer.duration) * 100;
          timeDisplay.textContent = `${formatVideoTime(cur)} / ${formatVideoTime(dur)}`;
        }

        function shouldRunSmoothSeekLoop() {
          const playerPage = document.getElementById("page-player");
          return !document.hidden && !!playerPage && playerPage.classList.contains("active-page");
        }

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
          seekBar.style.setProperty("--progress", `${newValue}%`);
          smoothSeekRafId = requestAnimationFrame(smoothSeek);
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

        function bindTimeUpdateEvents(onTimeupdateExtra) {
          videoPlayer.addEventListener("timeupdate", syncSeekBarWithVideo);
          videoPlayer.addEventListener("timeupdate", syncPlaybackClockWithVideo);
          if (onTimeupdateExtra) {
            videoPlayer.addEventListener("timeupdate", onTimeupdateExtra);
          }
        }

        function bindSeekBarInput() {
          seekBar.addEventListener("input", () => {
            if (!videoPlayer.duration) return;
            videoPlayer.currentTime = (seekBar.value / 100) * videoPlayer.duration;
            updateSeekBarFill();
          });
          updateSeekBarFill();
        }

        function initializeSeekBarState() {
          seekBar.value = 0;
          seekBar.style.setProperty("--progress", "0%");
        }

        return {
          resetSeekBar,
          updateSmoothSeekLoopState,
          bindTimeUpdateEvents,
          bindSeekBarInput,
          initializeSeekBarState,
        };
      }

      function bindPlayerFullscreenButton(btnFull, onToggleFullscreen) {
        btnFull.addEventListener("click", async () => {
          await onToggleFullscreen();
        });
      }

      function bindPlayerPictureInPictureButton(videoPlayer, btnPip) {
        if (!btnPip) return;

        const canUseStandardPip =
          typeof videoPlayer.requestPictureInPicture === "function";
        const canUseWebkitPip =
          typeof videoPlayer.webkitSetPresentationMode === "function" &&
          "webkitPresentationMode" in videoPlayer;
        const isPipSupported = canUseStandardPip || canUseWebkitPip;

        const updatePipButtonState = () => {
          const standardActive = document.pictureInPictureElement === videoPlayer;
          const webkitActive =
            canUseWebkitPip && videoPlayer.webkitPresentationMode === "picture-in-picture";
          const isActive = !!(standardActive || webkitActive);
          btnPip.classList.toggle("active", isActive);
          btnPip.title = isActive
            ? "ピクチャーインピクチャ終了"
            : "ピクチャーインピクチャ";
        };

        if (!isPipSupported) {
          btnPip.style.opacity = "0.6";
          btnPip.title = "このブラウザではPiP APIに未対応";
          btnPip.addEventListener("click", () => {
            console.warn("Picture-in-Picture is not supported in this browser.");
          });
          return;
        }

        const exitFullscreenIfNeeded = async () => {
          if (!document.fullscreenElement) return;
          if (typeof document.exitFullscreen === "function") {
            await document.exitFullscreen();
          }
        };

        btnPip.addEventListener("click", async () => {
          try {
            await exitFullscreenIfNeeded();

            if (canUseStandardPip && document.pictureInPictureEnabled !== false) {
              if (document.pictureInPictureElement === videoPlayer) {
                await document.exitPictureInPicture();
              } else {
                if (videoPlayer.readyState < 1) {
                  throw new Error("Video is not ready for PiP yet.");
                }
                if (videoPlayer.paused) {
                  try {
                    await videoPlayer.play();
                  } catch (_playError) {
                    // ユーザー操作直後でも再生に失敗する環境があるため、ここでは継続。
                  }
                }
                await videoPlayer.requestPictureInPicture();
              }
            } else if (canUseWebkitPip) {
              const nextMode =
                videoPlayer.webkitPresentationMode === "picture-in-picture"
                  ? "inline"
                  : "picture-in-picture";
              videoPlayer.webkitSetPresentationMode(nextMode);
            }
          } catch (error) {
            console.warn("Picture-in-Picture toggle failed:", error);
          } finally {
            updatePipButtonState();
          }
        });

        videoPlayer.addEventListener("enterpictureinpicture", updatePipButtonState);
        videoPlayer.addEventListener("leavepictureinpicture", updatePipButtonState);
        updatePipButtonState();
      }

      function createPlayerUiController({
        videoPlayer,
        seekBar,
        btnPlay,
        btnPip,
        btnFull,
        timeDisplay,
        onToggleFullscreen,
        onSidebarToggled,
        renderSortedComments,
      }) {
        const seekSync = createPlayerSeekSyncController(
          videoPlayer,
          seekBar,
          timeDisplay,
        );
        const actions = createPlayerPlaybackActions(videoPlayer);

        function releasePlayerResources() {
          try {
            videoPlayer.pause();
          } catch (_error) {
            // noop
          }
          try {
            videoPlayer.removeAttribute("src");
            videoPlayer.load();
          } catch (_error) {
            // noop
          }
        }

        function initializePlayerUiBindings() {
          seekSync.initializeSeekBarState();
          seekSync.bindTimeUpdateEvents(() => {
            syncLiveChatScrollForCurrentTime(videoPlayer);
          });
          seekSync.bindSeekBarInput();
          bindPlayButton(videoPlayer, btnPlay);
          bindVideoClickInteractions(videoPlayer, onToggleFullscreen);
          bindSpeedMenu(videoPlayer);
          bindSidebarToggles(onSidebarToggled);
          bindCommentSortMenu(renderSortedComments);
          bindQuickButtonsAndVolume(videoPlayer, actions.skip);
          bindKeyboardShortcuts(
            videoPlayer,
            actions.skip,
            actions.changeVolume,
            actions.togglePlay,
          );
          bindTimestampSeekLinks(videoPlayer);
          bindAutoHideControls();
          bindPlayerPictureInPictureButton(videoPlayer, btnPip);
          bindPlayerFullscreenButton(btnFull, onToggleFullscreen);

          window.updateSmoothSeekLoopState = seekSync.updateSmoothSeekLoopState;
          document.addEventListener(
            "visibilitychange",
            seekSync.updateSmoothSeekLoopState,
          );
          window.addEventListener("pagehide", releasePlayerResources);
          window.addEventListener("beforeunload", releasePlayerResources);
        }

        return {
          initialize: initializePlayerUiBindings,
          resetSeekBar: seekSync.resetSeekBar,
          updateSmoothSeekLoopState: seekSync.updateSmoothSeekLoopState,
        };
      }

      
