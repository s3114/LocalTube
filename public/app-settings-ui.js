// Settings UI module extracted from app.js
(function attachSettingsUi(global) {
const defaultSettingsUiDependencies = {
  fetchImpl: (...args) => global.fetch(...args),
  parseApiResponseImpl: (response) => global.parseApiResponse(response),
  notifyInfoImpl: (message) => global.alert?.(message),
  notifyErrorImpl: (message) => global.alert?.(message),
  confirmImpl: (message) => global.confirm?.(message) ?? true,
  writeClipboardTextImpl: async (text) => {
    if (global.navigator?.clipboard?.writeText) {
      await global.navigator.clipboard.writeText(text);
      return;
    }
    throw new Error("Clipboard API unavailable");
  },
};

let settingsUiDeps = { ...defaultSettingsUiDependencies };

function setSettingsUiDependencies(overrides = {}) {
  settingsUiDeps = {
    ...defaultSettingsUiDependencies,
    ...overrides,
  };
}

function clampNumberInRange(value, min, max, fallback) {
        const num = Number(value);
        if (!Number.isFinite(num)) return fallback;
        return Math.max(min, Math.min(max, num));
      }

      function applyCookieSettingsFromServer(elements, updateCookieButtonStyles, settings) {
        if (settings.selectedBrowser === "firefox") {
          elements.cookieStatusDisplay.textContent = "自動連携: Firefox";
          updateCookieButtonStyles(elements.setFirefoxBtn);
          return;
        }
        elements.cookieStatusDisplay.textContent = "設定されていません";
        updateCookieButtonStyles(null);
      }

      function applyLocalVideoDirsFromServer(elements, settings) {
        const dirs = Array.isArray(settings.localVideoDirs) ? settings.localVideoDirs : [];
        elements.localVideoDirsInput.value = dirs.join("\n");
        setSettingStatus(
          elements.localVideoDirsStatus,
          dirs.length > 0
            ? `${dirs.length} 件のフォルダーを登録中`
            : "追加フォルダーは未設定です",
          "muted",
        );
      }

      function applyFallbackThumbnailSettingFromServer(elements, settings) {
        const fallbackEnabled = settings.enableFallbackThumbnails !== false;
        elements.optFallbackThumbnails.checked = fallbackEnabled;
        setSettingStatus(
          elements.fallbackThumbStatus,
          fallbackEnabled ? "有効です" : "無効です",
          "muted",
        );
      }

      function getWallpaperStyleFromServerSettings(settings) {
        const blurValue = clampNumberInRange(settings.wallpaperBlur, 0, 30, 0);
        const brightnessValue = clampNumberInRange(
          settings.wallpaperBrightness,
          30,
          200,
          100,
        );
        return { blurValue, brightnessValue };
      }

      function setSettingStatus(targetElement, message, tone = "info") {
        if (!targetElement) return;
        targetElement.textContent = message;
        const colorMap = {
          info: "var(--blue)",
          success: "var(--green)",
          error: "var(--accent)",
          muted: "var(--subtext)",
        };
        targetElement.style.color = colorMap[tone] || colorMap.info;
      }

      function setWallpaperStatusText(elements, message, tone = "info") {
        setSettingStatus(elements.wallpaperStatus, message, tone);
      }

      function previewWallpaperFromRangeInputs(elements, bridge) {
        bridge.applyWallpaperStyle(
          bridge.getCurrentWallpaperUrl(),
          Number(elements.wallpaperBlurRange.value),
          Number(elements.wallpaperBrightnessRange.value),
        );
      }

      async function saveWallpaperNumericSetting(
        bridge,
        valueKey,
        value,
        onSucceeded,
      ) {
        const payload = {};
        payload[valueKey] = Number(value);
        const result = await bridge.postSettings(payload);
        if (!result.ok) {
          throw new Error(`${valueKey} setting save failed`);
        }
        await onSucceeded?.();
      }

      function initializeGeneralSettingStorageBindings(elements) {
        elements.fmt.value = loadLocalSetting("fmt", elements.fmt.value);
        elements.savePath.value = loadLocalSetting("savePath", "");
        elements.optHistory.checked = loadLocalSetting("optHistory", true);
        elements.optThumb.checked = loadLocalSetting("optThumb", true);
        elements.optDrm.checked = loadLocalSetting("optDrm", false);
        const loadedParallel = loadLocalSetting("optParallelDownloads", "3");
        elements.optParallelDownloads.value = loadedParallel;
        elements.parallelDownloadsValue.textContent = loadedParallel;
        const loadedFragments = loadLocalSetting("optConcurrentFragments", "4");
        elements.optConcurrentFragments.value = loadedFragments;
        elements.concurrentFragmentsValue.textContent = loadedFragments;
        elements.commentOptions.value = loadLocalSetting(
          "commentOptions",
          elements.commentOptions.value,
        );

        elements.fmt.addEventListener("change", (e) =>
          saveLocalSetting("fmt", e.target.value),
        );
        elements.savePath.addEventListener("input", (e) =>
          saveLocalSetting("savePath", e.target.value),
        );
        elements.optHistory.addEventListener("change", (e) =>
          saveLocalSetting("optHistory", e.target.checked),
        );
        elements.optThumb.addEventListener("change", (e) =>
          saveLocalSetting("optThumb", e.target.checked),
        );
        elements.optDrm.addEventListener("change", (e) =>
          saveLocalSetting("optDrm", e.target.checked),
        );
        elements.optParallelDownloads.addEventListener("input", (e) => {
          elements.parallelDownloadsValue.textContent = e.target.value;
          saveLocalSetting("optParallelDownloads", e.target.value);
        });
        elements.optConcurrentFragments.addEventListener("input", (e) => {
          elements.concurrentFragmentsValue.textContent = e.target.value;
          saveLocalSetting("optConcurrentFragments", e.target.value);
        });
        elements.commentOptions.addEventListener("change", (e) =>
          saveLocalSetting("commentOptions", e.target.value),
        );
      }

      function initializeHistoryClearButton(elements) {
        elements.clearHistoryBtn.addEventListener("click", async () => {
          if (!settingsUiDeps.confirmImpl("ダウンロード履歴を削除しますか？")) return;
          try {
            const response = await settingsUiDeps.fetchImpl("/api/clear-history", {
              method: "POST",
            });
            const result = await settingsUiDeps.parseApiResponseImpl(response);
            if (!result.ok) throw new Error(result.error || "履歴の削除に失敗しました。");
            settingsUiDeps.notifyInfoImpl(result.data?.message || "履歴を削除しました。");
          } catch (error) {
            console.error("履歴削除エラー:", error);
            settingsUiDeps.notifyErrorImpl("履歴の削除に失敗しました。");
          }
        });
      }

      function initializeAutostartTaskButtons() {
        const autostartToggle = document.getElementById("opt-autostart-task");
        const autostartStatus = document.getElementById("autostart-status");

        if (!autostartToggle || !autostartStatus) return;

        async function syncAutostartStatus() {
          autostartStatus.textContent = "状態を確認中...";
          autostartStatus.style.color = "var(--blue)";
          try {
            const response = await settingsUiDeps.fetchImpl("/api/schedule/status");
            const result = await settingsUiDeps.parseApiResponseImpl(response);
            if (!result.ok) {
              throw new Error(result.error || "状態の取得に失敗しました。");
            }
            const enabled = Boolean(result.data?.enabled);
            autostartToggle.checked = enabled;
            autostartStatus.textContent = enabled
              ? "現在: 有効"
              : "現在: 無効";
            autostartStatus.style.color = enabled ? "var(--green)" : "var(--main-txt)";
          } catch (error) {
            console.error("自動起動タスク状態取得エラー:", error);
            autostartStatus.textContent = "状態の取得に失敗しました。";
            autostartStatus.style.color = "var(--accent)";
          }
        }

        async function handleAutostart(endpoint, nextCheckedState) {
          try {
            autostartStatus.textContent = "処理中...";
            autostartStatus.style.color = "var(--blue)";
            const response = await settingsUiDeps.fetchImpl(endpoint, { method: "POST" });
            const result = await settingsUiDeps.parseApiResponseImpl(response);

            if (result.ok) {
              autostartStatus.textContent = result.data?.message || "完了しました。";
              autostartStatus.style.color = "var(--green)";
            } else {
              autostartToggle.checked = !nextCheckedState;
              autostartStatus.textContent = `エラー: ${result.error || "処理に失敗しました。"}`;
              autostartStatus.style.color = "var(--accent)";
            }
          } catch (error) {
            console.error("自動起動タスク操作エラー:", error);
            autostartToggle.checked = !nextCheckedState;
            autostartStatus.textContent = "通信エラーが発生しました。";
            autostartStatus.style.color = "var(--accent)";
          }
        }

        autostartToggle.addEventListener("change", () => {
          const nextCheckedState = autostartToggle.checked;
          const confirmed = nextCheckedState
            ? settingsUiDeps.confirmImpl(
              "PC起動時にこのアプリケーションを自動で起動するように設定しますか？",
            )
            : settingsUiDeps.confirmImpl("PC起動時の自動実行を解除しますか？");

          if (!confirmed) {
            autostartToggle.checked = !nextCheckedState;
            return;
          }

          const endpoint = nextCheckedState
            ? "/api/schedule/create"
            : "/api/schedule/delete";
          handleAutostart(endpoint, nextCheckedState);
        });

        syncAutostartStatus();
      }

      function initializeServerRestartButton() {
        const restartButton = document.getElementById("btn-restart-server");
        const shutdownButton = document.getElementById("btn-shutdown-server");
        const restartStatus = document.getElementById("server-restart-status");
        if (!restartButton || !shutdownButton || !restartStatus) return;

        restartButton.addEventListener("click", async () => {
          if (!settingsUiDeps.confirmImpl("localhost:3000 を再起動しますか？")) return;
          restartStatus.textContent = "再起動リクエストを送信中...";
          restartStatus.style.color = "var(--blue)";
          restartButton.disabled = true;
          try {
            const response = await settingsUiDeps.fetchImpl("/api/system/restart", {
              method: "POST",
            });
            const result = await settingsUiDeps.parseApiResponseImpl(response);
            if (!result.ok) {
              throw new Error(result.error || "再起動に失敗しました。");
            }
            restartStatus.textContent = "再起動中です。数秒後にページを再読み込みしてください。";
            restartStatus.style.color = "var(--green)";
          } catch (error) {
            console.error("サーバー再起動エラー:", error);
            restartStatus.textContent = `エラー: ${error.message || "再起動に失敗しました。"}`;
            restartStatus.style.color = "var(--accent)";
            restartButton.disabled = false;
          }
        });

        shutdownButton.addEventListener("click", async () => {
          const confirmed = settingsUiDeps.confirmImpl(
            "localhost:3000 を強制終了しますか？（再起動はされません）",
          );
          if (!confirmed) return;
          restartStatus.textContent = "強制終了リクエストを送信中...";
          restartStatus.style.color = "var(--warn)";
          restartButton.disabled = true;
          shutdownButton.disabled = true;
          try {
            const response = await settingsUiDeps.fetchImpl("/api/system/shutdown", {
              method: "POST",
            });
            const result = await settingsUiDeps.parseApiResponseImpl(response);
            if (!result.ok) {
              throw new Error(result.error || "強制終了に失敗しました。");
            }
            restartStatus.textContent = "サーバーを終了しました。必要に応じて起動.batから再起動してください。";
            restartStatus.style.color = "var(--green)";
          } catch (error) {
            console.error("サーバー強制終了エラー:", error);
            restartStatus.textContent = `エラー: ${error.message || "強制終了に失敗しました。"}`;
            restartStatus.style.color = "var(--accent)";
            restartButton.disabled = false;
            shutdownButton.disabled = false;
          }
        });
      }

      function initializeConsoleLogViewer() {
        const logOutput = document.getElementById("console-log-output");
        const logStatus = document.getElementById("console-log-status");
        const clearButton = document.getElementById("console-log-clear-btn");
        const pauseToggle = document.getElementById("console-log-pause");
        if (!logOutput || !logStatus || !clearButton || !pauseToggle) return;

        let sinceId = 0;
        let pollTimer = null;
        const MAX_LINES = 800;

        function appendLogLine(entry) {
          const line = document.createElement("div");
          const level = String(entry.level || "info").toLowerCase();
          line.className = `console-log-line level-${level}`;

          const ts = document.createElement("span");
          ts.className = "console-log-ts";
          ts.textContent = String(entry.timestamp || "");

          const lv = document.createElement("span");
          lv.className = `console-log-level level-${level}`;
          lv.textContent = `[${level}]`;

          const scope = document.createElement("span");
          scope.className = "console-log-scope";
          scope.textContent = `[${String(entry.scope || "app")}]`;

          const message = document.createElement("span");
          message.className = "console-log-message";
          message.textContent = String(entry.message || "");

          line.appendChild(ts);
          line.appendChild(document.createTextNode(" "));
          line.appendChild(lv);
          line.appendChild(document.createTextNode(" "));
          line.appendChild(scope);
          line.appendChild(document.createTextNode(" "));
          line.appendChild(message);
          logOutput.appendChild(line);
        }

        function trimLogLines() {
          while (logOutput.children.length > MAX_LINES) {
            logOutput.removeChild(logOutput.firstChild);
          }
        }

        function scrollLogToBottom() {
          logOutput.scrollTop = logOutput.scrollHeight;
        }

        async function pollLogs() {
          if (pauseToggle.checked) {
            logStatus.textContent = "一時停止中";
            logStatus.style.color = "var(--warn)";
            return;
          }

          try {
            const response = await settingsUiDeps.fetchImpl(
              `/api/logs?sinceId=${encodeURIComponent(sinceId)}&limit=250`,
            );
            const result = await settingsUiDeps.parseApiResponseImpl(response);
            if (!result.ok) {
              throw new Error(result.error || "ログ取得に失敗しました。");
            }
            const logs = Array.isArray(result.data?.logs) ? result.data.logs : [];
            logs.forEach((entry) => appendLogLine(entry));
            trimLogLines();
            if (logs.length > 0) {
              sinceId = Number(result.data?.lastId || sinceId);
            }
            scrollLogToBottom();
            logStatus.textContent = logs.length > 0
              ? `更新: ${logs.length}件`
              : "接続中（更新待ち）";
            logStatus.style.color = "var(--green)";
          } catch (error) {
            console.error("ログ取得エラー:", error);
            logStatus.textContent = `エラー: ${error.message || "ログ取得に失敗しました。"}`;
            logStatus.style.color = "var(--accent)";
          }
        }

        clearButton.addEventListener("click", () => {
          logOutput.innerHTML = "";
          logStatus.textContent = "表示をクリアしました";
          logStatus.style.color = "var(--subtext)";
        });

        pauseToggle.addEventListener("change", () => {
          if (!pauseToggle.checked) {
            pollLogs();
          }
        });

        pollLogs();
        pollTimer = setInterval(pollLogs, 1000);

        global.addEventListener("beforeunload", () => {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        });
      }

      function initializeYoutubePlaylistConverterUI() {
        const youtubeChannelUrlInput = document.getElementById(
          "youtubeChannelUrlInput",
        );
        const youtubePlaylistUrlOutput = document.getElementById(
          "youtubePlaylistUrlOutput",
        );
        const copyPlaylistUrlBtn = document.getElementById("copyPlaylistUrlBtn");
        const channelUrlError = document.getElementById("channelUrlError");
        if (
          !youtubeChannelUrlInput ||
          !youtubePlaylistUrlOutput ||
          !copyPlaylistUrlBtn ||
          !channelUrlError
        )
          return;

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

          youtubePlaylistUrlOutput.value = "";
          channelUrlError.textContent = "";
          if (channelUrl === "") return;

          if (channelMatch) {
            const channelId = channelMatch[1];
            const playlistId = channelId.substring(2);
            youtubePlaylistUrlOutput.value = `https://www.youtube.com/playlist?list=UUMO${playlistId}`;
            return;
          }
          if (!handleMatch) {
            channelUrlError.textContent =
              "無効なYouTubeチャンネルURLまたはハンドルURLです。";
            return;
          }

          channelUrlError.textContent = "ハンドルを解決中...";
          resolveTimeout = setTimeout(async () => {
            try {
              const response = await settingsUiDeps.fetchImpl("/api/resolve-handle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: channelUrl }),
              });
              const result = await settingsUiDeps.parseApiResponseImpl(response);
              if (result.ok) {
                const channelId = result.data?.channelId;
                if (!channelId) throw new Error("チャンネルIDの取得に失敗しました。");
                const playlistId = channelId.substring(2);
                youtubePlaylistUrlOutput.value = `https://www.youtube.com/playlist?list=UUMO${playlistId}`;
                channelUrlError.textContent = "";
              } else {
                channelUrlError.textContent = `エラー: ${result.error || "チャンネルIDの取得に失敗しました。"}`;
              }
            } catch (error) {
              channelUrlError.textContent =
                "ネットワークエラーまたはサーバーの問題が発生しました。";
              console.error("Error resolving handle:", error);
            }
          }, 500);
        });

        copyPlaylistUrlBtn.addEventListener("click", async () => {
          const playlistUrl = youtubePlaylistUrlOutput.value;
          if (!playlistUrl) {
            settingsUiDeps.notifyErrorImpl("変換された再生リストURLがありません。");
            return;
          }
          try {
            await settingsUiDeps.writeClipboardTextImpl(playlistUrl);
            settingsUiDeps.notifyInfoImpl("再生リストURLをコピーしました！");
          } catch (err) {
            console.error("Failed to copy: ", err);
            settingsUiDeps.notifyErrorImpl("コピーに失敗しました。手動でコピーしてください。");
          }
        });
      }

      function createSettingsServerBridge(elements) {
        let currentWallpaperUrl = null;

        function updateCookieButtonStyles(activeButton) {
          elements.setFirefoxBtn.style.background = "#333";
          elements.manualSelectBtn.style.background = "#333";
          elements.noneSelectBtn.style.background = "#333";
          if (activeButton) {
            activeButton.style.background = "var(--blue)";
          }
        }

        function applyWallpaperStyle(url, blurPx, brightnessPercent) {
          if (typeof url !== "undefined") {
            currentWallpaperUrl = url || null;
          }
          const safeBlur = clampNumberInRange(blurPx, 0, 30, 0);
          const safeBrightness = clampNumberInRange(brightnessPercent, 30, 200, 100);
          document.documentElement.style.setProperty(
            "--wallpaper-url",
            currentWallpaperUrl ? `url("${currentWallpaperUrl}")` : "none",
          );
          document.documentElement.style.setProperty("--wallpaper-blur", `${safeBlur}px`);
          document.documentElement.style.setProperty(
            "--wallpaper-brightness",
            `${safeBrightness}%`,
          );
          elements.wallpaperBlurRange.value = String(safeBlur);
          elements.wallpaperBlurValue.textContent = `${safeBlur} px`;
          elements.wallpaperBrightnessRange.value = String(safeBrightness);
          elements.wallpaperBrightnessValue.textContent = `${safeBrightness} %`;
        }

        async function postSettings(payload) {
          const response = await settingsUiDeps.fetchImpl("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          return settingsUiDeps.parseApiResponseImpl(response);
        }

        async function loadWallpaperMeta() {
          try {
            const response = await settingsUiDeps.fetchImpl("/api/wallpaper-meta");
            const result = await settingsUiDeps.parseApiResponseImpl(response);
            if (!result.ok) return null;
            const data = result.data || {};
            applyWallpaperStyle(
              data.url || null,
              data.wallpaperBlur ?? 2,
              data.wallpaperBrightness ?? 50,
            );
            setWallpaperStatusText(
              elements,
              data.exists ? "壁紙を設定済み" : "壁紙は未設定です",
              "muted",
            );
            return data;
          } catch (error) {
            console.error("壁紙情報の取得に失敗:", error);
            setWallpaperStatusText(elements, "壁紙情報の取得に失敗しました", "error");
            return null;
          }
        }

        async function loadServerSettings() {
          try {
            const response = await settingsUiDeps.fetchImpl("/api/settings");
            const result = await settingsUiDeps.parseApiResponseImpl(response);
            if (!result.ok) return null;
            const settings = result.data || {};
            applyCookieSettingsFromServer(
              elements,
              updateCookieButtonStyles,
              settings,
            );
            applyLocalVideoDirsFromServer(elements, settings);
            applyFallbackThumbnailSettingFromServer(elements, settings);
            const { blurValue, brightnessValue } =
              getWallpaperStyleFromServerSettings(settings);
            applyWallpaperStyle(null, blurValue, brightnessValue);
            return settings;
          } catch (error) {
            console.error("Failed to load settings:", error);
            return null;
          }
        }

        return {
          postSettings,
          loadWallpaperMeta,
          loadServerSettings,
          updateCookieButtonStyles,
          applyWallpaperStyle,
          getCurrentWallpaperUrl: () => currentWallpaperUrl,
        };
      }

      function initializeCookieSettingsUI(elements, bridge) {
        elements.setFirefoxBtn.addEventListener("click", async () => {
          window.selectedCookieFile = null;
          try {
            const result = await bridge.postSettings({ browser: "firefox" });
            if (result.ok) {
              elements.cookieStatusDisplay.textContent = "自動連携: Firefox";
              bridge.updateCookieButtonStyles(elements.setFirefoxBtn);
            }
          } catch (error) {
            console.error("ネットワークエラー:", error);
          }
        });

        elements.manualSelectBtn.addEventListener("click", () => {
          elements.cookiePathSet.click();
        });

        elements.cookiePathSet.addEventListener("change", async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          window.selectedCookieFile = file;
          try {
            const result = await bridge.postSettings({ browser: "" });
            if (result.ok) {
              elements.cookieStatusDisplay.textContent = `手動指定: ${file.name}`;
              bridge.updateCookieButtonStyles(elements.manualSelectBtn);
            }
          } catch (error) {
            console.error("ネットワークエラー:", error);
          }
        });

        elements.noneSelectBtn.addEventListener("click", async () => {
          window.selectedCookieFile = null;
          try {
            const result = await bridge.postSettings({ browser: "" });
            if (result.ok) {
              elements.cookieStatusDisplay.textContent = "設定されていません";
              bridge.updateCookieButtonStyles(elements.noneSelectBtn);
            }
          } catch (error) {
            console.error("ネットワークエラー:", error);
          }
        });
      }

      async function initializeWallpaperSettingsData(bridge) {
        await bridge.loadServerSettings();
        await bridge.loadWallpaperMeta();
      }

      async function clearWallpaperSetting(elements, bridge) {
        const response = await settingsUiDeps.fetchImpl("/api/wallpaper/clear", { method: "POST" });
        const result = await settingsUiDeps.parseApiResponseImpl(response);
        if (!result.ok) {
          throw new Error(result.error || "壁紙のクリアに失敗しました。");
        }
        bridge.applyWallpaperStyle(
          null,
          Number(elements.wallpaperBlurRange.value),
          Number(elements.wallpaperBrightnessRange.value),
        );
      }

      async function uploadWallpaperFileSetting(elements, bridge, file) {
        const formData = new FormData();
        formData.append("wallpaper", file);
        formData.append("wallpaperBlur", elements.wallpaperBlurRange.value);
        formData.append(
          "wallpaperBrightness",
          elements.wallpaperBrightnessRange.value,
        );
        const response = await settingsUiDeps.fetchImpl("/api/wallpaper", {
          method: "POST",
          body: formData,
        });
        const result = await settingsUiDeps.parseApiResponseImpl(response);
        if (!result.ok) {
          throw new Error(result.error || "壁紙の保存に失敗しました。");
        }
        bridge.applyWallpaperStyle(
          result.data?.url || null,
          result.data?.wallpaperBlur ?? 2,
          result.data?.wallpaperBrightness ?? 50,
        );
      }

      function bindWallpaperRangeInputPreview(elements, bridge, rangeElement) {
        rangeElement.addEventListener("input", () => {
          previewWallpaperFromRangeInputs(elements, bridge);
        });
      }

      function bindWallpaperRangePersistence(
        elements,
        bridge,
        rangeElement,
        settingKey,
        successMessage,
        failureMessage,
      ) {
        rangeElement.addEventListener("change", async (e) => {
          try {
            await saveWallpaperNumericSetting(
              bridge,
              settingKey,
              Number(e.target.value),
              async () => {
                setWallpaperStatusText(elements, successMessage, "success");
                await bridge.loadWallpaperMeta();
              },
            );
          } catch (error) {
            console.error(`${settingKey} 設定の保存エラー:`, error);
            setWallpaperStatusText(elements, failureMessage, "error");
          }
        });
      }

      function buildLocalVideoDirsStatusText(dirs) {
        return dirs.length > 0
          ? `${dirs.length} 件のフォルダーを登録しました`
          : "追加フォルダーをクリアしました";
      }

      function areSameStringArrayValues(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        return a.every((v, i) => v === b[i]);
      }

      async function saveLocalVideoDirsWithRecovery(bridge, inputDirs) {
        const result = await bridge.postSettings({ localVideoDirs: inputDirs });
        const savedDirs = Array.isArray(result.data?.settings?.localVideoDirs)
          ? result.data.settings.localVideoDirs
          : null;
        const saved = result.ok && Array.isArray(savedDirs);
        if (saved) {
          return { ok: true, dirs: savedDirs };
        }

        const refreshed = await bridge.loadServerSettings();
        const refreshedDirs = normalizeDirListForUi(refreshed?.localVideoDirs || []);
        if (refreshed && Array.isArray(refreshedDirs)) {
          return { ok: true, dirs: refreshedDirs };
        }
        throw new Error(`フォルダー設定の保存に失敗しました (status: ${result.status})`);
      }

      async function recoverLocalVideoDirsOnSaveError(bridge, inputDirs) {
        const refreshed = await bridge.loadServerSettings();
        const refreshedDirs = normalizeDirListForUi(refreshed?.localVideoDirs || []);
        const recovered = areSameStringArrayValues(refreshedDirs, inputDirs);
        return recovered ? refreshedDirs : null;
      }

      async function saveFallbackThumbnailSettingWithRecovery(bridge, enabled) {
        const result = await bridge.postSettings({
          enableFallbackThumbnails: enabled,
        });
        const savedValue = result.data?.settings?.enableFallbackThumbnails;
        const saved = result.ok && savedValue === enabled;
        if (saved) return true;

        const refreshed = await bridge.loadServerSettings();
        const recovered = refreshed?.enableFallbackThumbnails === enabled;
        if (!recovered) {
          throw new Error(`仮サムネイル設定の保存に失敗しました (status: ${result.status})`);
        }
        return true;
      }

      function initializeWallpaperSettingsUI(elements, bridge) {
        initializeWallpaperSettingsData(bridge).catch((error) => {
          console.error("壁紙設定の初期化に失敗:", error);
        });

        elements.wallpaperSelectBtn.addEventListener("click", () => {
          elements.wallpaperFileInput.click();
        });

        elements.wallpaperClearBtn.addEventListener("click", async () => {
          try {
            await clearWallpaperSetting(elements, bridge);
            setWallpaperStatusText(elements, "壁紙をクリアしました。", "success");
          } catch (error) {
            console.error("壁紙クリアエラー:", error);
            setWallpaperStatusText(elements, "壁紙のクリアに失敗しました。", "error");
          }
        });

        elements.wallpaperFileInput.addEventListener("change", async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          try {
            await uploadWallpaperFileSetting(elements, bridge, file);
            setWallpaperStatusText(
              elements,
              `壁紙を保存しました: ${file.name}`,
              "success",
            );
          } catch (error) {
            console.error("壁紙の保存エラー:", error);
            setWallpaperStatusText(
              elements,
              "壁紙の保存に失敗しました。画像形式を確認してください。",
              "error",
            );
          } finally {
            elements.wallpaperFileInput.value = "";
          }
        });

        bindWallpaperRangeInputPreview(elements, bridge, elements.wallpaperBlurRange);
        bindWallpaperRangeInputPreview(
          elements,
          bridge,
          elements.wallpaperBrightnessRange,
        );
        bindWallpaperRangePersistence(
          elements,
          bridge,
          elements.wallpaperBlurRange,
          "wallpaperBlur",
          "Blur設定を保存しました。",
          "Blur設定の保存に失敗しました。",
        );
        bindWallpaperRangePersistence(
          elements,
          bridge,
          elements.wallpaperBrightnessRange,
          "wallpaperBrightness",
          "Brightness設定を保存しました。",
          "Brightness設定の保存に失敗しました。",
        );
      }

      function initializeLocalVideoFoldersSettingsUI(elements, bridge, onLocalVideosChanged) {
        elements.saveLocalVideoDirsBtn.addEventListener("click", async () => {
          const inputDirs = normalizeDirListForUi(
            elements.localVideoDirsInput.value.split("\n"),
          );
          setSettingStatus(elements.localVideoDirsStatus, "保存中...", "info");

          try {
            const savedState = await saveLocalVideoDirsWithRecovery(bridge, inputDirs);
            const appliedDirs = savedState.dirs;
            setSettingStatus(
              elements.localVideoDirsStatus,
              buildLocalVideoDirsStatusText(appliedDirs),
              "success",
            );
            await onLocalVideosChanged?.();
          } catch (error) {
            console.error("ローカル動画フォルダー設定の保存に失敗:", error);
            const recoveredDirs = await recoverLocalVideoDirsOnSaveError(
              bridge,
              inputDirs,
            );
            if (recoveredDirs) {
              setSettingStatus(
                elements.localVideoDirsStatus,
                buildLocalVideoDirsStatusText(recoveredDirs),
                "success",
              );
              await onLocalVideosChanged?.();
              return;
            }
            setSettingStatus(
              elements.localVideoDirsStatus,
              "保存に失敗しました。パスを確認して再試行してください。",
              "error",
            );
          }
        });
      }

      function initializeFallbackThumbnailSettingUI(elements, bridge, onLocalVideosChanged) {
        elements.optFallbackThumbnails.addEventListener("change", async (e) => {
          const enabled = e.target.checked;
          setSettingStatus(elements.fallbackThumbStatus, "保存中...", "info");
          try {
            await saveFallbackThumbnailSettingWithRecovery(bridge, enabled);
            setSettingStatus(
              elements.fallbackThumbStatus,
              enabled ? "有効にしました" : "無効にしました",
              "success",
            );
            await onLocalVideosChanged?.();
          } catch (error) {
            console.error("仮サムネイル設定の保存に失敗:", error);
            const refreshed = await bridge.loadServerSettings();
            if (!refreshed) {
              elements.optFallbackThumbnails.checked = !enabled;
            }
            setSettingStatus(
              elements.fallbackThumbStatus,
              "保存に失敗しました。再試行してください。",
              "error",
            );
          }
        });
      }

      
function initializeSettingsUiController({
        elements,
        onLocalVideosChanged,
        dependencies = {},
      }) {
        setSettingsUiDependencies(dependencies);
        initializeGeneralSettingStorageBindings(elements);
        initializeHistoryClearButton(elements);
        initializeAutostartTaskButtons();
        initializeServerRestartButton();
        initializeConsoleLogViewer();
        initializeYoutubePlaylistConverterUI();

        const bridge = createSettingsServerBridge(elements);
        initializeCookieSettingsUI(elements, bridge);
        initializeWallpaperSettingsUI(elements, bridge);
        initializeLocalVideoFoldersSettingsUI(
          elements,
          bridge,
          onLocalVideosChanged,
        );
        initializeFallbackThumbnailSettingUI(
          elements,
          bridge,
          onLocalVideosChanged,
        );
      }

global.initializeSettingsUiController = initializeSettingsUiController;
global.__settingsUiTestUtils = {
    setSettingStatus,
    buildLocalVideoDirsStatusText,
    applyLocalVideoDirsFromServer,
    applyFallbackThumbnailSettingFromServer,
  };
})(window);
