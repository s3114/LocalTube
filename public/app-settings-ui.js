// Settings UI module extracted from app.js
(function attachSettingsUi(global) {
const DISCONNECT_RELOAD_DELAY_KEY = "localtube.disconnectReloadDelayMs";
const COOKIE_MODE_STORAGE_KEY = "localtube.cookieSelectionMode";
const COOKIE_UPDATED_AT_STORAGE_KEY = "localtube.cookieUpdatedAt";
const UPDATE_HISTORY_FILTER_STORAGE_KEY = "localtube.updateHistoryFilter";
const FEEDBACK_FORM_ACTION =
  "https://docs.google.com/forms/u/0/d/e/1FAIpQLSclkUPg2xtalK8G2N6g7e2iSrXuZy7rz1QQnLnxvsLh8sByNw/formResponse";
const FEEDBACK_CATEGORY_ENTRY_NAME = "entry.430026484";
const FEEDBACK_MESSAGE_ENTRY_NAME = "entry.1820568644";
const FEEDBACK_DISCORD_QUESTION_URL =
  "https://discord.com/channels/1332943491688300566/1470084207937196143";
const FEEDBACK_DISCORD_DESKTOP_URL =
  "discord://discord.com/channels/1332943491688300566/1470084207937196143";
const FEEDBACK_QUESTION_MESSAGE =
  "ここでの質問に返答することはできません。\n質問はdiscordフォームにてお願いします。";
const SETTINGS_SEARCH_PLACEHOLDER = "設定を検索";
const defaultSettingsUiDependencies = {
  fetchImpl: (...args) => global.fetch(...args),
  parseApiResponseImpl: (response) => global.parseApiResponse(response),
  notifyInfoImpl: () => {},
  notifyErrorImpl: () => {},
  writeClipboardTextImpl: async (text) => {
    const clipboardText = String(text ?? "");

    if (global.navigator?.clipboard?.writeText && global.isSecureContext) {
      try {
        await global.navigator.clipboard.writeText(clipboardText);
        return;
      } catch {
        // fallback to execCommand
      }
    }

    const input = global.document?.createElement("input");
    if (!input || !global.document?.body) {
      throw new Error("Clipboard API unavailable");
    }
    input.value = clipboardText;
    input.setAttribute("type", "text");
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.top = "8px";
    input.style.left = "8px";
    input.style.width = "1px";
    input.style.height = "1px";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    input.style.zIndex = "-1";

    global.document.body.appendChild(input);
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, input.value.length);

    const copied = Boolean(global.document.execCommand?.("copy"));
    global.document.body.removeChild(input);
    if (!copied) {
      throw new Error("Clipboard fallback copy failed");
    }
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

      function applyYtDlpCustomCommandFromServer(elements, settings) {
        if (!elements.ytDlpCustomCommandInput) return;
        elements.ytDlpCustomCommandInput.value = String(
          settings.ytDlpCustomCommand || "",
        );
        setSettingStatus(
          elements.ytDlpCustomCommandStatus,
          elements.ytDlpCustomCommandInput.value
            ? "カスタムコマンドを設定済み"
            : "カスタムコマンドは未設定です",
          "muted",
        );
      }

      function setCookieSelectionMetadata(mode) {
        const normalizedMode = String(mode || "none");
        const updatedAt = new Date().toISOString();
        saveLocalSetting(COOKIE_MODE_STORAGE_KEY, normalizedMode);
        saveLocalSetting(COOKIE_UPDATED_AT_STORAGE_KEY, updatedAt);
        return updatedAt;
      }

      function readCookieSelectionMetadata() {
        const mode = loadLocalSetting(COOKIE_MODE_STORAGE_KEY, "none");
        const updatedAt = loadLocalSetting(COOKIE_UPDATED_AT_STORAGE_KEY, "");
        let updatedAtLocal = "";

        if (updatedAt) {
          const date = new Date(updatedAt);
          if (!Number.isNaN(date.getTime())) {
            const yyyy = date.getFullYear();
            const MM = String(date.getMonth() + 1).padStart(2, "0");
            const dd = String(date.getDate()).padStart(2, "0");
            const hh = String(date.getHours()).padStart(2, "0");
            const mm = String(date.getMinutes()).padStart(2, "0");
            const ss = String(date.getSeconds()).padStart(2, "0");
            updatedAtLocal = `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
          }
        }

        return {
          mode,
          updatedAt,
          updatedAtLocal,
        };
      }

      function extractFilenameFromDisposition(dispositionValue) {
        const raw = String(dispositionValue || "");
        if (!raw) return "";
        const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match) {
          try {
            return decodeURIComponent(utf8Match[1]);
          } catch {
            return utf8Match[1];
          }
        }
        const simpleMatch = raw.match(/filename="?([^"]+)"?/i);
        return simpleMatch ? simpleMatch[1] : "";
      }

      function buildDownloadSettingsSnapshot(elements) {
        return {
          formatValue: elements.fmt?.value || "",
          formatText:
            elements.fmt?.options?.[elements.fmt.selectedIndex]?.textContent || "",
          savePath: elements.savePath?.value || "",
          saveHistory: Boolean(elements.optHistory?.checked),
          downloadThumb: Boolean(elements.optThumb?.checked),
          embedThumbnail: Boolean(elements.optEmbedThumbnail?.checked),
          addMetadata: Boolean(elements.optAddMetadata?.checked),
          remuxVideo: Boolean(elements.optRemuxVideo?.checked),
          staticFormat: Boolean(elements.optStaticFormat?.checked),
          forceIpv4: Boolean(elements.optForceIpv4?.checked),
          drmProtect: Boolean(elements.optDrm?.checked),
          parallelDownloads: elements.optParallelDownloads?.value || "",
          concurrentFragments: elements.optConcurrentFragments?.value || "",
          downloadComments: Boolean(elements.optDownloadComments?.checked),
          downloadChat: Boolean(elements.optDownloadChat?.checked),
          downloadVideo: Boolean(elements.optDownloadVideo?.checked),
        };
      }

      function readBrowserBrands() {
        const brands = global.navigator?.userAgentData?.brands;
        if (!Array.isArray(brands)) return [];
        return brands
          .map((entry) => String(entry?.brand || "").trim())
          .filter(Boolean);
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
        if (elements.optEmbedThumbnail) {
          elements.optEmbedThumbnail.checked = loadLocalSetting("optEmbedThumbnail", true);
        }
        if (elements.optAddMetadata) {
          elements.optAddMetadata.checked = loadLocalSetting("optAddMetadata", true);
        }
        if (elements.optRemuxVideo) {
          elements.optRemuxVideo.checked = loadLocalSetting("optRemuxVideo", false);
        }
        if (elements.optStaticFormat) {
          elements.optStaticFormat.checked = loadLocalSetting("optStaticFormat", false);
        }
        if (elements.optForceIpv4) {
          elements.optForceIpv4.checked = loadLocalSetting("optForceIpv4", false);
        }
        elements.optDrm.checked = loadLocalSetting("optDrm", false);
        const loadedParallel = loadLocalSetting("optParallelDownloads", "3");
        elements.optParallelDownloads.value = loadedParallel;
        elements.parallelDownloadsValue.textContent = loadedParallel;
        const loadedFragments = loadLocalSetting("optConcurrentFragments", "4");
        elements.optConcurrentFragments.value = loadedFragments;
        elements.concurrentFragmentsValue.textContent = loadedFragments;
        if (elements.optDownloadComments) {
          elements.optDownloadComments.checked = loadLocalSetting(
            "optDownloadComments",
            true,
          );
        }
        if (elements.optDownloadChat) {
          elements.optDownloadChat.checked = loadLocalSetting("optDownloadChat", true);
        }
        if (elements.optDownloadVideo) {
          elements.optDownloadVideo.checked = loadLocalSetting("optDownloadVideo", true);
        }

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
        elements.optEmbedThumbnail?.addEventListener("change", (e) =>
          saveLocalSetting("optEmbedThumbnail", e.target.checked),
        );
        elements.optAddMetadata?.addEventListener("change", (e) =>
          saveLocalSetting("optAddMetadata", e.target.checked),
        );
        elements.optRemuxVideo?.addEventListener("change", (e) =>
          saveLocalSetting("optRemuxVideo", e.target.checked),
        );
        elements.optStaticFormat?.addEventListener("change", (e) =>
          saveLocalSetting("optStaticFormat", e.target.checked),
        );
        elements.optForceIpv4?.addEventListener("change", (e) =>
          saveLocalSetting("optForceIpv4", e.target.checked),
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
        elements.optDownloadComments?.addEventListener("change", (e) =>
          saveLocalSetting("optDownloadComments", e.target.checked),
        );
        elements.optDownloadChat?.addEventListener("change", (e) =>
          saveLocalSetting("optDownloadChat", e.target.checked),
        );
        elements.optDownloadVideo?.addEventListener("change", (e) =>
          saveLocalSetting("optDownloadVideo", e.target.checked),
        );
      }

      function showSettingsConfirmModal(elements, message) {
        if (
          !elements.settingsConfirmModalBackdrop ||
          !elements.settingsConfirmModalMessage ||
          !elements.settingsConfirmModalCancelBtn ||
          !elements.settingsConfirmModalConfirmBtn
        ) {
          return Promise.resolve(true);
        }

        return new Promise((resolve) => {
          const backdrop = elements.settingsConfirmModalBackdrop;
          const messageEl = elements.settingsConfirmModalMessage;
          const cancelBtn = elements.settingsConfirmModalCancelBtn;
          const confirmBtn = elements.settingsConfirmModalConfirmBtn;

          const cleanup = () => {
            backdrop.classList.add("hidden");
            cancelBtn.removeEventListener("click", onCancel);
            confirmBtn.removeEventListener("click", onConfirm);
            backdrop.removeEventListener("click", onBackdropClick);
          };

          const onCancel = () => {
            cleanup();
            resolve(false);
          };

          const onConfirm = () => {
            cleanup();
            resolve(true);
          };

          const onBackdropClick = (event) => {
            if (event.target !== backdrop) return;
            cleanup();
            resolve(false);
          };

          messageEl.textContent = String(message || "").trim();
          backdrop.classList.remove("hidden");
          cancelBtn.addEventListener("click", onCancel);
          confirmBtn.addEventListener("click", onConfirm);
          backdrop.addEventListener("click", onBackdropClick);
          global.requestAnimationFrame?.(() => {
            confirmBtn.focus?.();
          });
        });
      }

      function initializeHistoryClearButton(elements) {
        elements.clearHistoryBtn.addEventListener("click", async () => {
          const confirmed = await showSettingsConfirmModal(
            elements,
            "ダウンロード履歴を削除しますか？",
          );
          if (!confirmed) return;
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

      function initializeAutostartTaskButtons(elements) {
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

        autostartToggle.addEventListener("change", async () => {
          const nextCheckedState = autostartToggle.checked;
          const confirmed = await showSettingsConfirmModal(
            elements,
            nextCheckedState
              ? "PC起動時にこのアプリケーションを自動で起動するように設定しますか？"
              : "PC起動時の自動実行を解除しますか？",
          );

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

      function initializeServerRestartButton(elements) {
        const restartButton = document.getElementById("btn-restart-server");
        const restartNodeButton = document.getElementById("btn-restart-server-node");
        const shutdownButton = document.getElementById("btn-shutdown-server");
        const restartStatus = document.getElementById("server-restart-status");
        if (!restartButton || !restartNodeButton || !shutdownButton || !restartStatus) return;

        restartButton.addEventListener("click", async () => {
          const confirmed = await showSettingsConfirmModal(
            elements,
            "更新して localhost:3000 を再起動しますか？",
          );
          if (!confirmed) return;
          restartStatus.textContent = "再起動リクエストを送信中...";
          restartStatus.style.color = "var(--blue)";
          try {
            sessionStorage.setItem(DISCONNECT_RELOAD_DELAY_KEY, "15000");
          } catch {
            // noop
          }
          restartButton.disabled = true;
          restartNodeButton.disabled = true;
          try {
            const response = await settingsUiDeps.fetchImpl("/api/system/restart", {
              method: "POST",
            });
            const result = await settingsUiDeps.parseApiResponseImpl(response);
            if (!result.ok) {
              throw new Error(result.error || "再起動に失敗しました。");
            }
            restartStatus.textContent = "再起動中です。15秒後にページを再読み込みしてください。";
            restartStatus.style.color = "var(--green)";
          } catch (error) {
            console.error("サーバー再起動エラー:", error);
            restartStatus.textContent = `エラー: ${error.message || "再起動に失敗しました。"}`;
            restartStatus.style.color = "var(--accent)";
            restartButton.disabled = false;
            restartNodeButton.disabled = false;
          }
        });

        restartNodeButton.addEventListener("click", async () => {
          const confirmed = await showSettingsConfirmModal(
            elements,
            "server.js を直接再起動しますか？（起動.bat は使用しません）",
          );
          if (!confirmed) return;
          restartStatus.textContent = "server.js再起動リクエストを送信中...";
          restartStatus.style.color = "var(--blue)";
          try {
            sessionStorage.setItem(DISCONNECT_RELOAD_DELAY_KEY, "3000");
          } catch {
            // noop
          }
          restartButton.disabled = true;
          restartNodeButton.disabled = true;
          try {
            const response = await settingsUiDeps.fetchImpl("/api/system/restart-node", {
              method: "POST",
            });
            const result = await settingsUiDeps.parseApiResponseImpl(response);
            if (!result.ok) {
              throw new Error(result.error || "server.js の再起動に失敗しました。");
            }
            restartStatus.textContent = "server.js再起動中です。3秒後にページを再読み込みしてください。";
            restartStatus.style.color = "var(--green)";
          } catch (error) {
            console.error("server.js再起動エラー:", error);
            restartStatus.textContent = `エラー: ${error.message || "server.js の再起動に失敗しました。"}`;
            restartStatus.style.color = "var(--accent)";
            restartButton.disabled = false;
            restartNodeButton.disabled = false;
          }
        });

        shutdownButton.addEventListener("click", async () => {
          const confirmed = await showSettingsConfirmModal(
            elements,
            "localhost:3000 を強制終了しますか？（再起動はされません）",
          );
          if (!confirmed) return;
          restartStatus.textContent = "強制終了リクエストを送信中...";
          restartStatus.style.color = "var(--warn)";
          restartButton.disabled = true;
          restartNodeButton.disabled = true;
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
            restartNodeButton.disabled = false;
            shutdownButton.disabled = false;
          }
        });
      }

      function initializeConsoleLogViewer() {
        const logOutput = document.getElementById("console-log-output");
        const logStatus = document.getElementById("console-log-status");
        const clearButton = document.getElementById("console-log-clear-btn");
        const pauseToggle = document.getElementById("console-log-pause");
        const searchInput = document.getElementById("console-log-search");
        if (!logOutput || !logStatus || !clearButton || !pauseToggle || !searchInput) return;

        let sinceId = 0;
        let pollTimer = null;
        const MAX_LINES = 800;
        const LOG_POLL_INTERVAL_MS = 1000;
        const logEntries = [];
        pauseToggle.checked = false;

        function parseLogSearchQuery(query) {
          const includeTerms = [];
          const excludeTerms = [];
          String(query || "")
            .split(/\s+/)
            .map((part) => part.trim())
            .filter(Boolean)
            .forEach((part) => {
              if (part.startsWith("-") && part.length > 1) {
                excludeTerms.push(part.slice(1).toLowerCase());
                return;
              }
              includeTerms.push(part.toLowerCase());
            });
          return { includeTerms, excludeTerms };
        }

        function buildLogEntryText(entry) {
          return [
            String(entry.timestamp || ""),
            String(entry.level || ""),
            String(entry.scope || ""),
            String(entry.message || ""),
          ]
            .join(" ")
            .toLowerCase();
        }

        function doesLogEntryMatch(entry, query) {
          const haystack = buildLogEntryText(entry);
          const { includeTerms, excludeTerms } = parseLogSearchQuery(query);
          if (excludeTerms.some((term) => haystack.includes(term))) {
            return false;
          }
          return includeTerms.every((term) => haystack.includes(term));
        }

        function isSettingsPageActive() {
          const settingsPage = document.getElementById("page-settings");
          return Boolean(settingsPage?.classList.contains("active-page"));
        }

        function createLogLineElement(entry) {
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
          return line;
        }

        function trimLogEntries() {
          while (logEntries.length > MAX_LINES) {
            logEntries.shift();
          }
        }

        function renderFilteredLogs() {
          const query = searchInput.value || "";
          const fragment = document.createDocumentFragment();
          logEntries
            .filter((entry) => doesLogEntryMatch(entry, query))
            .forEach((entry) => {
              fragment.appendChild(createLogLineElement(entry));
            });
          logOutput.innerHTML = "";
          logOutput.appendChild(fragment);
        }

        function scrollLogToBottom() {
          logOutput.scrollTop = logOutput.scrollHeight;
        }

        async function pollLogs() {
          if (!isSettingsPageActive()) {
            logStatus.textContent = "設定ページで表示中にログを取得します";
            logStatus.style.color = "var(--subtext)";
            return;
          }

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
            logEntries.push(...logs);
            trimLogEntries();
            renderFilteredLogs();
            if (logs.length > 0) {
              sinceId = Number(result.data?.lastId || sinceId);
            }
            scrollLogToBottom();
            const visibleCount = logOutput.children.length;
            logStatus.textContent = logs.length > 0
              ? `更新: ${logs.length}件 / 表示: ${visibleCount}件`
              : `接続中（更新待ち） / 表示: ${visibleCount}件`;
            logStatus.style.color = "var(--green)";
          } catch (error) {
            console.error("ログ取得エラー:", error);
            logStatus.textContent = `エラー: ${error.message || "ログ取得に失敗しました。"}`;
            logStatus.style.color = "var(--accent)";
          }
        }

        clearButton.addEventListener("click", () => {
          logEntries.length = 0;
          renderFilteredLogs();
          logStatus.textContent = "表示をクリアしました";
          logStatus.style.color = "var(--subtext)";
        });

        searchInput.addEventListener("input", () => {
          renderFilteredLogs();
          const visibleCount = logOutput.children.length;
          logStatus.textContent = `検索結果: ${visibleCount}件`;
          logStatus.style.color = "var(--subtext)";
        });

        pauseToggle.addEventListener("change", () => {
          if (!pauseToggle.checked) {
            pollLogs();
          }
        });

        function startPolling() {
          if (pollTimer) return;
          pollTimer = setInterval(pollLogs, LOG_POLL_INTERVAL_MS);
        }

        function stopPolling() {
          if (!pollTimer) return;
          clearInterval(pollTimer);
          pollTimer = null;
        }

        function updatePollingByVisibility() {
          if (isSettingsPageActive()) {
            startPolling();
            pollLogs();
            return;
          }
          stopPolling();
        }

        updatePollingByVisibility();
        global.addEventListener("hashchange", updatePollingByVisibility);
        global.addEventListener("app:page-changed", updatePollingByVisibility);

        global.addEventListener("beforeunload", () => {
          global.removeEventListener("hashchange", updatePollingByVisibility);
          global.removeEventListener("app:page-changed", updatePollingByVisibility);
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        });
      }

      function initializeSettingsHeaderSearchUi() {
        const headerSearchInput = document.getElementById("home-search-input");
        const settingsPage = document.getElementById("page-settings");
        if (!headerSearchInput || !settingsPage) return;

        let settingsSearchValue = "";
        let homeSearchValue = headerSearchInput.value || "";
        let currentMode = settingsPage.classList.contains("active-page") ? "settings" : "other";

        function parseSearchTerms(query) {
          const includeTerms = [];
          const excludeTerms = [];
          String(query || "")
            .split(/\s+/)
            .map((part) => part.trim().toLowerCase())
            .filter(Boolean)
            .forEach((part) => {
              if (part.startsWith("-") && part.length > 1) {
                excludeTerms.push(part.slice(1));
                return;
              }
              includeTerms.push(part);
            });
          return { includeTerms, excludeTerms };
        }

        function matchesSearchText(text, query) {
          const haystack = String(text || "").toLowerCase();
          const { includeTerms, excludeTerms } = parseSearchTerms(query);
          if (excludeTerms.some((term) => haystack.includes(term))) return false;
          return includeTerms.every((term) => haystack.includes(term));
        }

        function resetSettingsSearchResults() {
          settingsPage
            .querySelectorAll(".card.card-layout, .toggle")
            .forEach((element) => {
              element.style.display = "";
            });
        }

        function applySettingsSearch(query) {
          const normalizedQuery = String(query || "").trim();
          if (!normalizedQuery) {
            resetSettingsSearchResults();
            return;
          }

          const cards = Array.from(settingsPage.querySelectorAll(".card.card-layout"));
          cards.forEach((card) => {
            const cardMain = card.querySelector(".card-main");
            const toggles = Array.from(card.querySelectorAll(".options > .toggle"));
            const cardTitle = String(cardMain?.querySelector("h2")?.textContent || "").trim();
            const cardMatches = matchesSearchText(card.textContent, normalizedQuery);
            const titleMatches = matchesSearchText(cardTitle, normalizedQuery);

            let visibleToggleCount = 0;
            toggles.forEach((toggle) => {
              const toggleMatches =
                titleMatches || matchesSearchText(toggle.textContent, normalizedQuery);
              toggle.style.display = toggleMatches ? "" : "none";
              if (toggleMatches) visibleToggleCount += 1;
            });

            const shouldShowCard =
              titleMatches || cardMatches || toggles.length === 0 || visibleToggleCount > 0;
            card.style.display = shouldShowCard ? "" : "none";
          });
        }

        function syncHeaderSearchMode() {
          const isSettingsActive = settingsPage.classList.contains("active-page");
          const homePage = document.getElementById("page-home");
          const isHomeActive = Boolean(homePage?.classList.contains("active-page"));

          if (isSettingsActive) {
            if (currentMode !== "settings") {
              if (currentMode === "home") {
                homeSearchValue = headerSearchInput.value || "";
              }
              headerSearchInput.value = settingsSearchValue;
              headerSearchInput.placeholder = SETTINGS_SEARCH_PLACEHOLDER;
              currentMode = "settings";
            }
            applySettingsSearch(headerSearchInput.value);
            return;
          }

          resetSettingsSearchResults();
          if (currentMode === "settings") {
            settingsSearchValue = headerSearchInput.value || "";
            if (isHomeActive) {
              headerSearchInput.value = homeSearchValue;
            } else {
              headerSearchInput.value = "";
            }
          }
          currentMode = isHomeActive ? "home" : "other";
        }

        headerSearchInput.addEventListener("input", () => {
          if (!settingsPage.classList.contains("active-page")) return;
          settingsSearchValue = headerSearchInput.value || "";
          applySettingsSearch(settingsSearchValue);
        });

        global.addEventListener("app:page-changed", syncHeaderSearchMode);
        global.addEventListener("hashchange", syncHeaderSearchMode);
        syncHeaderSearchMode();
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

        const buildMembershipPlaylistUrl = (channelId) => {
          if (typeof channelId !== "string" || !channelId.startsWith("UC")) {
            return "";
          }
          return `https://www.youtube.com/playlist?list=UUMO${channelId.substring(2)}`;
        };

        let resolveTimeout;
        youtubeChannelUrlInput.addEventListener("input", () => {
          clearTimeout(resolveTimeout);
          const channelUrl = youtubeChannelUrlInput.value.trim();
          const channelRegex =
            /^https?:\/\/(www\.)?youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})\/?$/;
          const handleRegex =
            /^https?:\/\/(www\.)?youtube\.com\/@([a-zA-Z0-9._-]+)\/?$/;
          const watchRegex =
            /^https?:\/\/(www\.)?youtube\.com\/watch\?[^#]*\bv=[^&]+/;
          const shortWatchRegex =
            /^https?:\/\/youtu\.be\/[^/?#]+/;
          const channelMatch = channelUrl.match(channelRegex);
          const handleMatch = channelUrl.match(handleRegex);
          const isWatchUrl = watchRegex.test(channelUrl) || shortWatchRegex.test(channelUrl);

          youtubePlaylistUrlOutput.value = "";
          channelUrlError.textContent = "";
          if (channelUrl === "") return;

          if (channelMatch) {
            const channelId = channelMatch[2];
            youtubePlaylistUrlOutput.value = buildMembershipPlaylistUrl(channelId);
            return;
          }
          if (!handleMatch && !isWatchUrl) {
            channelUrlError.textContent =
              "無効なYouTubeチャンネルURL、ハンドルURL、または動画URLです。";
            return;
          }

          channelUrlError.textContent = "チャンネル情報を取得中...";
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
                youtubePlaylistUrlOutput.value = buildMembershipPlaylistUrl(channelId);
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

      function initializeLocalLanIpToolUI() {
        const localLanIpOutput = document.getElementById("localLanIpOutput");
        const refreshLocalLanIpBtn = document.getElementById("refreshLocalLanIpBtn");
        const copyLocalLanIpBtn = document.getElementById("copyLocalLanIpBtn");
        const localLanIpStatus = document.getElementById("localLanIpStatus");
        if (
          !localLanIpOutput ||
          !refreshLocalLanIpBtn ||
          !copyLocalLanIpBtn ||
          !localLanIpStatus
        ) {
          return;
        }

        const setStatus = (message, tone = "muted") => {
          setSettingStatus(localLanIpStatus, message, tone);
        };

        const loadLocalLanIp = async () => {
          setStatus("取得中...", "info");
          try {
            const response = await settingsUiDeps.fetchImpl("/api/network/local-ip");
            const result = await settingsUiDeps.parseApiResponseImpl(response);
            if (!result.ok) {
              throw new Error(result.error || "LAN内IPの取得に失敗しました。");
            }
            const ips = Array.isArray(result.data?.localIps) ? result.data.localIps : [];
            if (ips.length === 0) {
              localLanIpOutput.value = "";
              setStatus("利用可能なLAN内IPが見つかりませんでした", "error");
              return;
            }
            const endpoints = ips.map((ip) => `http://${ip}:3000`);
            localLanIpOutput.value = endpoints.join(", ");
            setStatus(`${ips.length} 件のLAN内IPを取得しました`, "success");
          } catch (error) {
            console.error("LAN内IP取得エラー:", error);
            localLanIpOutput.value = "";
            setStatus("LAN内IPの取得に失敗しました", "error");
          }
        };

        refreshLocalLanIpBtn.addEventListener("click", () => {
          loadLocalLanIp();
        });

        copyLocalLanIpBtn.addEventListener("click", async () => {
          if (!localLanIpOutput.value) {
            settingsUiDeps.notifyErrorImpl("コピーするLAN内IPがありません。");
            return;
          }
          try {
            await settingsUiDeps.writeClipboardTextImpl(localLanIpOutput.value);
            settingsUiDeps.notifyInfoImpl("LAN内IPをコピーしました。");
          } catch (error) {
            console.error("LAN内IPコピー失敗:", error);
            try {
              localLanIpOutput.focus({ preventScroll: true });
              localLanIpOutput.select();
            } catch {
              // noop
            }
            settingsUiDeps.notifyErrorImpl(
              "LAN内IPのコピーに失敗しました。表示欄を長押しして手動コピーしてください。",
            );
          }
        });

        loadLocalLanIp();
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
            applyYtDlpCustomCommandFromServer(elements, settings);
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
              setCookieSelectionMetadata("firefox");
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
              setCookieSelectionMetadata("manual");
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
              setCookieSelectionMetadata("none");
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

      async function triggerLocalVideoScanRefresh() {
        const response = await settingsUiDeps.fetchImpl("/api/local-videos?refresh=1");
        const result = await settingsUiDeps.parseApiResponseImpl(response);
        if (!result.ok) {
          throw new Error(result.error || "手動スキャンに失敗しました。");
        }
        return Array.isArray(result.data) ? result.data : [];
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
            setSettingStatus(
              elements.localVideoDirsStatus,
              "フォルダーを保存しました。手動スキャンを実行中...",
              "info",
            );
            const refreshedVideos = await triggerLocalVideoScanRefresh();
            setSettingStatus(
              elements.localVideoDirsStatus,
              `フォルダーを保存し、手動スキャンを完了しました。(${refreshedVideos.length}件)`,
              "success",
            );
            await onLocalVideosChanged?.(refreshedVideos);
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
              try {
                setSettingStatus(
                  elements.localVideoDirsStatus,
                  "フォルダー保存済み。手動スキャンを実行中...",
                  "info",
                );
                const refreshedVideos = await triggerLocalVideoScanRefresh();
                setSettingStatus(
                  elements.localVideoDirsStatus,
                  `フォルダーを保存し、手動スキャンを完了しました。(${refreshedVideos.length}件)`,
                  "success",
                );
                await onLocalVideosChanged?.(refreshedVideos);
              } catch (scanError) {
                console.error("手動スキャンの実行に失敗:", scanError);
                setSettingStatus(
                  elements.localVideoDirsStatus,
                  "フォルダーは保存済みですが、手動スキャンに失敗しました。再試行してください。",
                  "error",
                );
              }
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

      function initializeYtDlpCustomCommandSettingsUI(elements, bridge) {
        if (
          !elements.ytDlpCustomCommandInput ||
          !elements.saveYtDlpCustomCommandBtn ||
          !elements.ytDlpCustomCommandStatus
        ) {
          return;
        }

        elements.saveYtDlpCustomCommandBtn.addEventListener("click", async () => {
          const value = String(elements.ytDlpCustomCommandInput.value || "").trim();
          setSettingStatus(elements.ytDlpCustomCommandStatus, "保存中...", "info");
          try {
            const result = await bridge.postSettings({ ytDlpCustomCommand: value });
            if (!result.ok) {
              throw new Error(result.error || "カスタムコマンドの保存に失敗しました。");
            }
            setSettingStatus(
              elements.ytDlpCustomCommandStatus,
              value ? "カスタムコマンドを保存しました" : "カスタムコマンドをクリアしました",
              "success",
            );
            await bridge.loadServerSettings();
          } catch (error) {
            console.error("yt-dlp カスタムコマンド設定の保存に失敗:", error);
            setSettingStatus(
              elements.ytDlpCustomCommandStatus,
              "保存に失敗しました。再試行してください。",
              "error",
            );
          }
        });
      }

      function initializeUpdateHistoryFilterUI() {
        const buttons = Array.from(
          global.document?.querySelectorAll?.("[data-update-filter]") || [],
        );
        const items = Array.from(
          global.document?.querySelectorAll?.(".info-updates-item[data-version]") || [],
        );
        if (!buttons.length || !items.length) return;

        const isMinorOnlyVersion = (version) => {
          const match = String(version || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
          if (!match) return true;
          return match[3] === "0";
        };

        const applyFilter = (mode) => {
          const normalizedMode = mode === "all" ? "all" : "minor-only";
          buttons.forEach((button) => {
            button.classList.toggle(
              "active",
              button.dataset.updateFilter === normalizedMode,
            );
          });
          items.forEach((item) => {
            const version = item.dataset.version || "";
            const shouldShow =
              normalizedMode === "all" ? true : isMinorOnlyVersion(version);
            item.classList.toggle("info-updates-item-hidden", !shouldShow);
          });
          saveLocalSetting(UPDATE_HISTORY_FILTER_STORAGE_KEY, normalizedMode);
        };

        buttons.forEach((button) => {
          button.addEventListener("click", () => {
            applyFilter(button.dataset.updateFilter || "minor-only");
          });
        });

        applyFilter(loadLocalSetting(UPDATE_HISTORY_FILTER_STORAGE_KEY, "minor-only"));
      }

      function initializeReportGenerationUI(elements) {
        if (
          !elements.generateReportBtn ||
          !elements.reportGenerateStatus ||
          !elements.reportModalBackdrop ||
          !elements.reportModalCancelBtn ||
          !elements.reportModalConfirmBtn
        ) {
          return;
        }

        const openModal = () => {
          elements.reportModalBackdrop.classList.remove("hidden");
        };
        const closeModal = () => {
          elements.reportModalBackdrop.classList.add("hidden");
        };

        elements.generateReportBtn.addEventListener("click", () => {
          setSettingStatus(
            elements.reportGenerateStatus,
            "生成前の確認待ちです。",
            "muted",
          );
          openModal();
        });

        elements.reportModalCancelBtn.addEventListener("click", () => {
          closeModal();
          setSettingStatus(
            elements.reportGenerateStatus,
            "生成をキャンセルしました。",
            "muted",
          );
        });

        elements.reportModalBackdrop.addEventListener("click", (event) => {
          if (event.target === elements.reportModalBackdrop) {
            closeModal();
          }
        });

        elements.reportModalConfirmBtn.addEventListener("click", async () => {
          closeModal();
          elements.generateReportBtn.disabled = true;
          elements.reportModalConfirmBtn.disabled = true;
          elements.reportModalCancelBtn.disabled = true;
          setSettingStatus(
            elements.reportGenerateStatus,
            "レポートを生成しています...",
            "info",
          );

          try {
            const response = await settingsUiDeps.fetchImpl("/api/report/download", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                currentUrl: global.location?.href || "",
                browserUserAgent: global.navigator?.userAgent || "",
                browserBrands: readBrowserBrands(),
                generatedAt: new Date().toISOString(),
                cookieInfo: readCookieSelectionMetadata(),
                downloadSettings: buildDownloadSettingsSnapshot(elements),
              }),
            });

            if (!response.ok) {
              const payload = await settingsUiDeps.parseApiResponseImpl(response);
              throw new Error(payload.error || "レポート生成に失敗しました。");
            }

            const blob = await response.blob();
            const objectUrl = global.URL.createObjectURL(blob);
            const downloadLink = global.document.createElement("a");
            downloadLink.href = objectUrl;
            downloadLink.download =
              extractFilenameFromDisposition(
                response.headers.get("content-disposition"),
              ) || "localtube-report.html";
            global.document.body.appendChild(downloadLink);
            downloadLink.click();
            downloadLink.remove();
            global.URL.revokeObjectURL(objectUrl);

            setSettingStatus(
              elements.reportGenerateStatus,
              "レポートをダウンロードしました。",
              "success",
            );
          } catch (error) {
            console.error("レポート生成に失敗:", error);
            setSettingStatus(
              elements.reportGenerateStatus,
              error.message || "レポート生成に失敗しました。",
              "error",
            );
          } finally {
            elements.generateReportBtn.disabled = false;
            elements.reportModalConfirmBtn.disabled = false;
            elements.reportModalCancelBtn.disabled = false;
          }
        });
      }

      function initializeFeedbackModalUI(elements) {
        if (
          !elements.openFeedbackModalBtn ||
          !elements.feedbackModalStatus ||
          !elements.feedbackModalBackdrop ||
          !elements.feedbackModalCancelBtn ||
          !elements.feedbackModalConfirmBtn ||
          !elements.feedbackModalSubmitStatus ||
          !elements.feedbackCategorySelect ||
          !elements.feedbackMessageInput ||
          !elements.feedbackConfirmModalBackdrop ||
          !elements.feedbackConfirmModalCancelBtn ||
          !elements.feedbackConfirmModalConfirmBtn
        ) {
          return;
        }

        let isSubmitting = false;
        let lastEditableFeedbackMessage = "";

        const isQuestionCategory = () =>
          String(elements.feedbackCategorySelect.value || "").trim() === "質問";

        const setSubmitState = (message = "", tone = "muted") => {
          const text = String(message || "").trim();
          if (!text) {
            elements.feedbackModalSubmitStatus.textContent = "";
            elements.feedbackModalSubmitStatus.classList.add("hidden");
            elements.feedbackModalSubmitStatus.style.color = "";
            return;
          }
          elements.feedbackModalSubmitStatus.textContent = text;
          elements.feedbackModalSubmitStatus.classList.remove("hidden");
          if (tone === "success") {
            elements.feedbackModalSubmitStatus.style.color = "var(--ok)";
          } else if (tone === "error") {
            elements.feedbackModalSubmitStatus.style.color = "var(--danger)";
          } else {
            elements.feedbackModalSubmitStatus.style.color = "var(--subtext)";
          }
        };

        const setSubmitting = (submitting) => {
          isSubmitting = Boolean(submitting);
          elements.feedbackModalConfirmBtn.disabled = isSubmitting;
          elements.feedbackModalCancelBtn.disabled = isSubmitting;
          elements.feedbackCategorySelect.disabled = isSubmitting;
          elements.feedbackMessageInput.disabled = isSubmitting;
          if (isSubmitting) {
            elements.feedbackModalConfirmBtn.textContent = "送信中...";
            return;
          }
          elements.feedbackModalConfirmBtn.textContent = isQuestionCategory()
            ? "開く"
            : "送信";
        };

        const syncFeedbackCategoryMode = () => {
          if (isQuestionCategory()) {
            const currentMessage = String(elements.feedbackMessageInput.value || "");
            if (currentMessage.trim() && currentMessage !== FEEDBACK_QUESTION_MESSAGE) {
              lastEditableFeedbackMessage = currentMessage;
            }
            elements.feedbackMessageInput.value = FEEDBACK_QUESTION_MESSAGE;
            elements.feedbackMessageInput.readOnly = true;
            elements.feedbackModalConfirmBtn.textContent = isSubmitting ? "送信中..." : "開く";
            return;
          }

          const currentMessage = String(elements.feedbackMessageInput.value || "");
          if (currentMessage === FEEDBACK_QUESTION_MESSAGE) {
            elements.feedbackMessageInput.value = lastEditableFeedbackMessage;
          }
          elements.feedbackMessageInput.readOnly = false;
          elements.feedbackModalConfirmBtn.textContent = isSubmitting ? "送信中..." : "送信";
        };

        const openModal = () => {
          setSubmitState("");
          syncFeedbackCategoryMode();
          elements.feedbackModalBackdrop.classList.remove("hidden");
          global.requestAnimationFrame?.(() => {
            elements.feedbackMessageInput.focus?.();
          });
        };

        const closeModal = () => {
          if (isSubmitting) return;
          elements.feedbackModalBackdrop.classList.add("hidden");
        };

        const confirmFeedbackSend = () =>
          new Promise((resolve) => {
            const backdrop = elements.feedbackConfirmModalBackdrop;
            const cancelBtn = elements.feedbackConfirmModalCancelBtn;
            const confirmBtn = elements.feedbackConfirmModalConfirmBtn;

            const cleanup = () => {
              backdrop.classList.add("hidden");
              cancelBtn.removeEventListener("click", onCancel);
              confirmBtn.removeEventListener("click", onConfirm);
              backdrop.removeEventListener("click", onBackdropClick);
            };

            const onCancel = () => {
              cleanup();
              resolve(false);
            };

            const onConfirm = () => {
              cleanup();
              resolve(true);
            };

            const onBackdropClick = (event) => {
              if (event.target !== backdrop) return;
              cleanup();
              resolve(false);
            };

            backdrop.classList.remove("hidden");
            cancelBtn.addEventListener("click", onCancel);
            confirmBtn.addEventListener("click", onConfirm);
            backdrop.addEventListener("click", onBackdropClick);
            global.requestAnimationFrame?.(() => {
              confirmBtn.focus?.();
            });
          });

        const updateStatus = () => {
          const message = String(elements.feedbackMessageInput.value || "").trim();
          if (message) {
            elements.feedbackModalStatus.textContent = "";
          } else {
            elements.feedbackModalStatus.textContent = "";
          }
        };

        const submitFeedbackToGoogleForm = async () => {
          if (isQuestionCategory()) {
            const openDiscordQuestionChannel = () => {
              let fallbackTriggered = false;
              const fallbackToWeb = () => {
                if (fallbackTriggered) return;
                fallbackTriggered = true;
                global.open?.(
                  FEEDBACK_DISCORD_QUESTION_URL,
                  "_blank",
                  "noopener,noreferrer",
                );
              };

              const onVisibilityChange = () => {
                if (global.document?.hidden) {
                  fallbackTriggered = true;
                }
              };

              global.document?.addEventListener("visibilitychange", onVisibilityChange, {
                once: true,
              });

              try {
                global.location.href = FEEDBACK_DISCORD_DESKTOP_URL;
              } catch {
                fallbackToWeb();
                return;
              }

              global.setTimeout(() => {
                fallbackToWeb();
              }, 900);
            };

            openDiscordQuestionChannel();
            setSubmitState("Discord の質問フォームを開きました。", "success");
            settingsUiDeps.notifyInfoImpl("Discord の質問フォームを開きました。");
            closeModal();
            return;
          }

          const category = String(elements.feedbackCategorySelect.value || "").trim();
          const message = String(elements.feedbackMessageInput.value || "").trim();
          if (!message) {
            setSubmitState("内容を入力してください。", "error");
            settingsUiDeps.notifyErrorImpl("フィードバック内容を入力してください。");
            elements.feedbackMessageInput.focus?.();
            return;
          }

          const confirmed = await confirmFeedbackSend();
          if (!confirmed) return;

          setSubmitting(true);
          setSubmitState("Googleフォームへ送信しています...", "muted");
          try {
            const body = new URLSearchParams();
            body.set(FEEDBACK_CATEGORY_ENTRY_NAME, category);
            body.set(FEEDBACK_MESSAGE_ENTRY_NAME, message);

            await settingsUiDeps.fetchImpl(FEEDBACK_FORM_ACTION, {
              method: "POST",
              mode: "no-cors",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
              },
              body: body.toString(),
            });

            elements.feedbackMessageInput.value = "";
            elements.feedbackCategorySelect.value = "不具合報告";
            lastEditableFeedbackMessage = "";
            syncFeedbackCategoryMode();
            setSubmitState(
              "送信リクエストを受け付けました。ありがとうございます。",
              "success",
            );
            settingsUiDeps.notifyInfoImpl("フィードバックを送信しました。");
            updateStatus();
            global.setTimeout(() => {
              closeModal();
            }, 700);
          } catch (error) {
            console.error("feedback submit error:", error);
            setSubmitState("送信に失敗しました。時間を置いて再度お試しください。", "error");
            settingsUiDeps.notifyErrorImpl("フィードバックの送信に失敗しました。");
          } finally {
            setSubmitting(false);
          }
        };

        elements.openFeedbackModalBtn.addEventListener("click", () => {
          updateStatus();
          openModal();
        });

        elements.feedbackModalCancelBtn.addEventListener("click", () => {
          closeModal();
          updateStatus();
        });

        elements.feedbackModalConfirmBtn.addEventListener("click", async () => {
          await submitFeedbackToGoogleForm();
        });

        elements.feedbackModalBackdrop.addEventListener("click", (event) => {
          if (event.target === elements.feedbackModalBackdrop) {
            closeModal();
            updateStatus();
          }
        });

        [
          elements.feedbackCategorySelect,
          elements.feedbackMessageInput,
        ].forEach((element) => {
          element?.addEventListener("input", updateStatus);
          element?.addEventListener("change", updateStatus);
        });

        elements.feedbackCategorySelect.addEventListener("change", () => {
          syncFeedbackCategoryMode();
          updateStatus();
        });

        syncFeedbackCategoryMode();
        updateStatus();
      }

      
function initializeSettingsUiController({
        elements,
        onLocalVideosChanged,
        dependencies = {},
      }) {
        setSettingsUiDependencies(dependencies);
        initializeGeneralSettingStorageBindings(elements);
        initializeHistoryClearButton(elements);
        initializeAutostartTaskButtons(elements);
        initializeServerRestartButton(elements);
        initializeConsoleLogViewer();
        initializeSettingsHeaderSearchUi();
        initializeYoutubePlaylistConverterUI();
        initializeLocalLanIpToolUI();
        initializeUpdateHistoryFilterUI();

        const bridge = createSettingsServerBridge(elements);
        initializeCookieSettingsUI(elements, bridge);
        initializeWallpaperSettingsUI(elements, bridge);
        initializeLocalVideoFoldersSettingsUI(
          elements,
          bridge,
          onLocalVideosChanged,
        );
        initializeYtDlpCustomCommandSettingsUI(elements, bridge);
        initializeReportGenerationUI(elements);
        initializeFeedbackModalUI(elements);
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
