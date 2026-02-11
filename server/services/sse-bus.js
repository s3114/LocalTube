function createSseBus({
  sseExpress,
  jobHistory,
  serverStartTime,
  measureNetworkMbps,
  apiOk,
}) {
  const sseClients = new Set();

  function broadcast(event, data) {
    for (const client of sseClients) {
      client.sse(event, data);
    }
  }

  function registerRoutes(app) {
    app.get("/events", sseExpress, (req, res) => {
      sseClients.add(res);
      console.log("New SSE client connected.");
      res.sse("initial_state", Array.from(jobHistory.values()));

      async function broadcastSystemInfo() {
        const uptimeSec = Math.floor((Date.now() - serverStartTime) / 1000);

        const now = new Date();
        const serverTime = {
          yyyy: now.getFullYear(),
          MM: String(now.getMonth() + 1).padStart(2, "0"),
          dd: String(now.getDate()).padStart(2, "0"),
          hh: String(now.getHours()).padStart(2, "0"),
          mm: String(now.getMinutes()).padStart(2, "0"),
          ss: String(now.getSeconds()).padStart(2, "0"),
        };

        let net = null;
        try {
          net = await measureNetworkMbps();
        } catch (e) {
          console.error("measureNetworkMbps error:", e.message);
        }

        res.sse("system_info", {
          server_time: serverTime,
          latency_ms: net ? net.latency_ms : null,
          network_mbps: net ? net.approx_mbps : null,
          uptime_sec: uptimeSec,
        });
      }

      const sysInfoInterval = setInterval(broadcastSystemInfo, 1000);

      req.on("close", () => {
        sseClients.delete(res);
        clearInterval(sysInfoInterval);
        console.log("SSE client disconnected.");
      });
    });

    app.get("/ping", (_req, res) => {
      apiOk(res, { pong: true });
    });
  }

  return {
    broadcast,
    registerRoutes,
  };
}

module.exports = {
  createSseBus,
};
