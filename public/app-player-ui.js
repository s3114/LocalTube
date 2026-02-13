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

      function bindCommentSortMenu(renderSortedComments) {
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

            const sorted = [...window.currentVideoComments];
            if (sortType === "popular") {
              sorted.sort((a, b) => (b.like_count || 0) - (a.like_count || 0));
            } else if (sortType === "newest") {
              sorted.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            }
            renderSortedComments(sorted);
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
          target.offsetTop - chatContainer.clientHeight / 2 + target.clientHeight / 2;
        chatContainer.scrollTo({
          top: Math.max(0, targetOffset),
          behavior: "smooth",
        });
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

      function createPlayerUiController({
        videoPlayer,
        seekBar,
        btnPlay,
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
          bindAutoHideControls();
          bindPlayerFullscreenButton(btnFull, onToggleFullscreen);

          window.updateSmoothSeekLoopState = seekSync.updateSmoothSeekLoopState;
          document.addEventListener(
            "visibilitychange",
            seekSync.updateSmoothSeekLoopState,
          );
        }

        return {
          initialize: initializePlayerUiBindings,
          resetSeekBar: seekSync.resetSeekBar,
          updateSmoothSeekLoopState: seekSync.updateSmoothSeekLoopState,
        };
      }

      
