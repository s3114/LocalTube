const fs = require("fs");
const { createLogger } = require("../services/logger-service");

function buildScheduleResultFromStdout(stdout) {
  const resultContent = stdout.trim();

  if (resultContent.startsWith("SUCCESS:")) {
    const messageLines = resultContent.split("\n");
    const cleanMessage = messageLines[0].replace("SUCCESS: ", "").trim();
    return { ok: true, message: cleanMessage, detail: null };
  }

  if (resultContent.startsWith("ERROR:")) {
    const messageLines = resultContent.split("\n");
    const cleanMessage = messageLines[0].replace("ERROR: ", "").trim();
    return { ok: false, message: cleanMessage, detail: resultContent.trim() };
  }

  return null;
}

function detectScheduleModeFromXml(xmlText) {
  const xml = String(xmlText || "");
  if (/<LogonTrigger\b/i.test(xml)) return "logon";
  if (/<BootTrigger\b/i.test(xml)) return "startup";
  return "unknown";
}

function readResultFileContent(resultFilePath) {
  const targetPath = String(resultFilePath || "").trim();
  if (!targetPath) return "";
  try {
    if (!fs.existsSync(targetPath)) return "";
    return fs.readFileSync(targetPath, "utf8").trim();
  } catch {
    return "";
  }
}

function removeResultFileQuietly(resultFilePath) {
  const targetPath = String(resultFilePath || "").trim();
  if (!targetPath) return;
  try {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  } catch {
    // noop
  }
}

function registerScheduleRoutes(app, deps) {
  const { path, os, spawn, baseDir, apiOk, apiError } = deps;
  const logger = deps.logger || createLogger("route-schedule");

  function runPowerShellScript(scriptPath, args) {
    return new Promise((resolve) => {
      const psArgs = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        ...args,
      ];
      const child = spawn("powershell.exe", psArgs, {
        shell: false,
        windowsHide: false,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        resolve({ error, stdout, stderr, code: 1 });
      });
      child.on("close", (code) => {
        resolve({ error: null, stdout, stderr, code: Number(code) || 0 });
      });
    });
  }

  function runSchtasks(args) {
    return new Promise((resolve) => {
      const child = spawn("schtasks", args, {
        shell: false,
        windowsHide: false,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (error) => {
        resolve({ error, stdout, stderr, code: 1 });
      });
      child.on("close", (code) => {
        resolve({ error: null, stdout, stderr, code: Number(code) || 0 });
      });
    });
  }

  app.get("/api/schedule/status", async (_req, res) => {
    const taskName = "YoutubeDL-AutoStart";
    const { error, code, stdout, stderr } = await runSchtasks([
      "/query",
      "/tn",
      taskName,
      "/xml",
    ]);

    if (error) {
      return apiError(res, 500, "タスク状態の取得に失敗しました。", {
        detail: stderr || error.message,
      });
    }

    if (code === 0) {
      return apiOk(res, {
        enabled: true,
        mode: detectScheduleModeFromXml(stdout),
      });
    }

    return apiOk(res, { enabled: false, mode: "disabled" });
  });

  app.post("/api/schedule/create", async (req, res) => {
    const taskName = "YoutubeDL-AutoStart";
    const batPath = path.resolve(baseDir, "起動.bat");
    const psScriptPath = path.resolve(baseDir, "create_autostart_task.ps1");
    const triggerMode = String(req.body?.mode || "startup").trim().toLowerCase();
    const resultFilePath = path.join(
      os.tmpdir(),
      `autostart_result_create_${Date.now()}.txt`,
    );

    if (!["startup", "logon"].includes(triggerMode)) {
      return apiError(res, 400, "無効な自動起動モードです。");
    }

    logger.info("executing PowerShell script", {
      psScriptPath,
      taskName,
      batPath,
      triggerMode,
    });

    const { error, stdout, stderr } = await runPowerShellScript(psScriptPath, [
      "-TaskName",
      taskName,
      "-BatPath",
      batPath,
      "-TriggerMode",
      triggerMode,
      "-ResultFilePath",
      resultFilePath,
    ]);

    try {
      const resultText = stdout.trim() || readResultFileContent(resultFilePath);
      const result = buildScheduleResultFromStdout(resultText);
      if (result?.ok) {
        return apiOk(res, { message: result.message });
      }
      if (result && !result.ok) {
        return apiError(res, 500, result.message, { detail: result.detail });
      }
      if (error) {
        return apiError(res, 500, "コマンド実行に失敗しました。", {
          detail: stderr || error.message,
        });
      }
      return apiError(
        res,
        500,
        "タスク作成リクエストの処理中に予期せぬ問題が発生しました。",
        { detail: `stdout: ${stdout}, stderr: ${stderr}, resultFile: ${resultText}` },
      );
    } finally {
      removeResultFileQuietly(resultFilePath);
    }
  });

  app.post("/api/schedule/delete", async (_req, res) => {
    const taskName = "YoutubeDL-AutoStart";
    const psScriptPath = path.resolve(baseDir, "delete_autostart_task.ps1");
    const resultFilePath = path.join(
      os.tmpdir(),
      `autostart_result_delete_${Date.now()}.txt`,
    );

    logger.info("executing PowerShell script", { psScriptPath, taskName });

    const { error, stdout, stderr } = await runPowerShellScript(psScriptPath, [
      "-TaskName",
      taskName,
      "-ResultFilePath",
      resultFilePath,
    ]);

    try {
      const resultText = stdout.trim() || readResultFileContent(resultFilePath);
      const result = buildScheduleResultFromStdout(resultText);
      if (result?.ok) {
        return apiOk(res, { message: result.message });
      }
      if (result && !result.ok) {
        return apiError(res, 500, result.message, { detail: result.detail });
      }
      if (error) {
        return apiError(res, 500, "コマンド実行に失敗しました。", {
          detail: stderr || error.message,
        });
      }
      return apiError(
        res,
        500,
        "タスク削除リクエストの処理中に予期せぬ問題が発生しました。",
        { detail: `stdout: ${stdout}, stderr: ${stderr}, resultFile: ${resultText}` },
      );
    } finally {
      removeResultFileQuietly(resultFilePath);
    }
  });
}

module.exports = {
  registerScheduleRoutes,
  buildScheduleResultFromStdout,
  detectScheduleModeFromXml,
};
