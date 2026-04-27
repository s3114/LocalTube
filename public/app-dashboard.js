(function attachDashboardController(global) {
    function createDashboardController({
    jobStates,
    renderJob,
    updateJobElement,
    onSseError = (error) => console.error("EventSource failed:", error),
    documentRef = document,
    EventSourceImpl = EventSource,
    ChartImpl = global.Chart,
    nowProvider = () => new Date(),
  }) {
    function countJobsByStatus() {
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
      const totalEl = documentRef.getElementById("info-total-count");
      const completedEl = documentRef.getElementById("info-completed-count");
      const runningEl = documentRef.getElementById("info-running-count");
      const errorEl = documentRef.getElementById("info-error-count");
      if (totalEl) totalEl.textContent = `${jobCounts.total} 件`;
      if (completedEl) completedEl.textContent = `${jobCounts.completed} 件`;
      if (runningEl) runningEl.textContent = `${jobCounts.running} 件`;
      if (errorEl) errorEl.textContent = `${jobCounts.error} 件`;

      const bar = documentRef.getElementById("completion-bar");
      const text = documentRef.getElementById("completion-text");
      if (bar) bar.style.width = `${jobCounts.completionRate}%`;
      if (text) text.textContent = `${jobCounts.completionRate}%`;
    }

    function updateDashboardServerClock(serverTime) {
      if (!serverTime) return;
      const clockEl = documentRef.getElementById("info-clock");
      if (!clockEl) return;
      clockEl.textContent =
        `${serverTime.yyyy}/${serverTime.MM}/${serverTime.dd} ` +
        `${serverTime.hh}:${serverTime.mm}:${serverTime.ss}`;
    }

    function updateDashboardNetworkLatency(data) {
      const netEl = documentRef.getElementById("info-network");
      if (netEl && data.network_mbps != null) {
        netEl.textContent = `${data.network_mbps} Mbps (推定)`;
      }
      const latEl = documentRef.getElementById("info-latency");
      if (latEl && data.latency_ms != null) {
        latEl.textContent = `${data.latency_ms} ms`;
      }
    }

    function updateDashboardUptime(uptimeSec) {
      const upEl = documentRef.getElementById("info-uptime");
      if (!upEl || typeof uptimeSec !== "number") return;

      const h = Math.floor(uptimeSec / 3600);
      const m = Math.floor((uptimeSec % 3600) / 60);
      const s = uptimeSec % 60;
      upEl.textContent = `${h}時間 ${m}分 ${s}秒`;
    }

    function createDashboardNetworkChart() {
      const canvas = documentRef.getElementById("networkChart");
      if (!canvas) return null;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      if (!ChartImpl) return null;
      return new ChartImpl(ctx, {
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

      const now = nowProvider();
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
      const frag = documentRef.createDocumentFragment();
      jobs.forEach((job) => {
        frag.appendChild(renderJob(job));
      });
      jobQueueElement.appendChild(frag);
    }

    function appendDashboardJobs(jobQueueElement, jobs) {
      if (!jobQueueElement) return;
      const frag = documentRef.createDocumentFragment();
      jobs.forEach((job) => {
        frag.appendChild(renderJob(job));
      });
      jobQueueElement.appendChild(frag);
    }

    function prependDashboardConnectionError() {
      const statusWrap = documentRef.getElementById("header-connection-status");
      const statusText = documentRef.getElementById("header-connection-status-text");
      if (!statusWrap || !statusText) return;
      statusText.textContent =
        "サーバーとの接続が切れました。起動.batが正常に動作しているか確認してください。";
      statusWrap.classList.add("visible");
    }

    function clearDashboardConnectionError() {
      const statusWrap = documentRef.getElementById("header-connection-status");
      const statusText = documentRef.getElementById("header-connection-status-text");
      if (!statusWrap || !statusText) return;
      statusWrap.classList.remove("visible");
      statusText.textContent = "";
    }

      function applyDashboardJobPatch({ id, patch, onJobUpdated, updateCounts }) {
        const job = jobStates.get(id);
        if (!job) return;
        const prevStatus = job.status;
        Object.assign(job, patch);
        updateJobElement(job);
        if (updateCounts) {
          renderDashboardJobCounts(countJobsByStatus());
        }
        if (
          prevStatus !== "completed" &&
          patch.status === "completed" &&
          typeof documentRef.dispatchEvent === "function"
        ) {
          documentRef.dispatchEvent(
            new CustomEvent("job_completed", {
              detail: { id },
            }),
          );
        }
        onJobUpdated?.();
      }

    function createSseController({ jobQueueElement, onJobUpdated }) {
      const AUTO_RELOAD_KEY = "localtube.sseReloadAttempts";
      const DISCONNECT_RELOAD_DELAY_KEY = "localtube.disconnectReloadDelayMs";
      const MAX_AUTO_RELOAD_ATTEMPTS = 10;
      let reloadTimer = null;
      let reloadCountdownTimer = null;
      const netBuffer = [];
      const latencyBuffer = [];
      const avgWindow = 5;
      const networkChart = createDashboardNetworkChart();

      const eventSource = new EventSourceImpl("/events");
      eventSource.onopen = () => {
        if (reloadTimer) {
          clearTimeout(reloadTimer);
          reloadTimer = null;
        }
        if (reloadCountdownTimer) {
          clearInterval(reloadCountdownTimer);
          reloadCountdownTimer = null;
        }
        try {
          sessionStorage.removeItem(AUTO_RELOAD_KEY);
          sessionStorage.removeItem(DISCONNECT_RELOAD_DELAY_KEY);
        } catch {
          // noop
        }
        clearDashboardConnectionError();
      };

      function scheduleAutoReloadOnDisconnect() {
        if (reloadTimer) return;

        let attempts = 0;
        try {
          attempts = Number(sessionStorage.getItem(AUTO_RELOAD_KEY) || "0");
        } catch {
          attempts = 0;
        }

        if (attempts >= MAX_AUTO_RELOAD_ATTEMPTS) return;

        const nextAttempt = attempts + 1;
        let delayMs = 15000;
        try {
          const requestedDelayMs = Number(sessionStorage.getItem(DISCONNECT_RELOAD_DELAY_KEY));
          if (Number.isFinite(requestedDelayMs)) {
            delayMs = Math.max(1000, Math.min(60000, requestedDelayMs));
          }
        } catch {
          // noop
        }
        try {
          sessionStorage.setItem(AUTO_RELOAD_KEY, String(nextAttempt));
        } catch {
          // noop
        }

        const statusWrap = documentRef.getElementById("header-connection-status");
        const statusText = documentRef.getElementById("header-connection-status-text");
        let remainingSec = Math.ceil(delayMs / 1000);
        const updateCountdownText = () => {
          if (!statusWrap || !statusText) return;
          statusText.textContent =
            `サーバーとの接続が切れました。${remainingSec}秒後に再接続を試みます。`;
          statusWrap.classList.add("visible");
        };
        if (statusWrap && statusText) {
          updateCountdownText();
          reloadCountdownTimer = setInterval(() => {
            remainingSec = Math.max(0, remainingSec - 1);
            updateCountdownText();
            if (remainingSec <= 0 && reloadCountdownTimer) {
              clearInterval(reloadCountdownTimer);
              reloadCountdownTimer = null;
            }
          }, 1000);
        }

        reloadTimer = setTimeout(() => {
          if (reloadCountdownTimer) {
            clearInterval(reloadCountdownTimer);
            reloadCountdownTimer = null;
          }
          if (typeof global.location?.reload === "function") {
            global.location.reload();
          }
        }, delayMs);
      }

      eventSource.addEventListener("initial_state", (e) => {
        const jobs = JSON.parse(e.data);
        replaceDashboardJobs(jobQueueElement, jobs);
        renderDashboardJobCounts(countJobsByStatus());
        onJobUpdated?.();
      });

      eventSource.addEventListener("jobs_added", (e) => {
        const newJobs = JSON.parse(e.data);
        appendDashboardJobs(jobQueueElement, newJobs);
        renderDashboardJobCounts(countJobsByStatus());
        onJobUpdated?.();
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

      eventSource.onerror = (error) => {
        onSseError(error);
        prependDashboardConnectionError();
        scheduleAutoReloadOnDisconnect();
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
          avgWindow,
          data.network_mbps,
          data.latency_ms,
        );
      });

      return {
        close() {
          eventSource.close();
        },
      };
    }

    return {
      createSseController,
    };
  }

  global.createDashboardController = createDashboardController;
})(window);
