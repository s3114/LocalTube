(function attachAppCore(global) {
  function createAppCore({ jobStates }) {
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
        hints.push("Cookieファイルを指定し、再度ダウンロードを実行してください。");
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

    function parseTimestampToSeconds(token) {
      if (!token || typeof token !== "string") return null;
      const parts = token.split(":").map((part) => Number.parseInt(part, 10));
      if (parts.some((value) => !Number.isFinite(value) || value < 0)) return null;

      if (parts.length === 2) {
        const [mm, ss] = parts;
        if (ss > 59) return null;
        return mm * 60 + ss;
      }

      if (parts.length === 3) {
        const [hh, mm, ss] = parts;
        if (mm > 59 || ss > 59) return null;
        return hh * 3600 + mm * 60 + ss;
      }

      return null;
    }

    function linkifyTimestampsInPlainText(text) {
      const source = String(text || "");
      const timestampRegex = /(\b\d{1,2}:[0-5]\d:[0-5]\d\b|\b[0-5]?\d:[0-5]\d\b)/g;
      const parts = [];
      let lastIndex = 0;

      for (const match of source.matchAll(timestampRegex)) {
        const token = match[0];
        const start = match.index ?? 0;
        const seconds = parseTimestampToSeconds(token);
        if (!Number.isFinite(seconds)) continue;

        parts.push(escapeHtml(source.slice(lastIndex, start)));
        parts.push(
          `<a href="#" class="timestamp-link" data-seconds="${escapeAttr(seconds)}">${escapeHtml(token)}</a>`,
        );
        lastIndex = start + token.length;
      }

      parts.push(escapeHtml(source.slice(lastIndex)));
      return parts.join("");
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
        parts.push(linkifyTimestampsInPlainText(source.slice(lastIndex, start)));
        parts.push(
          `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="desc-link">${escapeHtml(url)}</a>`,
        );
        lastIndex = start + url.length;
      }

      parts.push(linkifyTimestampsInPlainText(source.slice(lastIndex)));
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
      const progressTextElement = jobElement.querySelector(".job-progress-text");
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

    return {
      renderJob,
      updateJobElement,
      parseApiResponse,
      linkifyText,
    };
  }

  function saveLocalSetting(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn("localStorage 保存失敗:", error);
    }
  }

  function loadLocalSetting(key, defaultValue) {
    try {
      const storedValue = localStorage.getItem(key);
      if (storedValue === null) return defaultValue;
      if (typeof defaultValue === "boolean") return storedValue === "true";
      return storedValue;
    } catch (error) {
      console.warn("localStorage 読み込み失敗:", error);
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

  global.createAppCore = createAppCore;
  global.saveLocalSetting = saveLocalSetting;
  global.loadLocalSetting = loadLocalSetting;
  global.normalizeDirListForUi = normalizeDirListForUi;
})(window);
