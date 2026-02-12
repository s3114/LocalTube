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
    const { error, code, stderr } = await runSchtasks([
      "/query",
      "/tn",
      taskName,
      "/fo",
      "list",
    ]);

    if (error) {
      return apiError(res, 500, "タスク状態の取得に失敗しました。", {
        detail: stderr || error.message,
      });
    }

    if (code === 0) {
      return apiOk(res, { enabled: true });
    }

    return apiOk(res, { enabled: false });
  });

  app.post("/api/schedule/create", async (_req, res) => {
    const taskName = "YoutubeDL-AutoStart";
    const batPath = path.resolve(baseDir, "起動.bat");
    const psScriptPath = path.resolve(baseDir, "create_autostart_task.ps1");
    const resultFilePath = path.join(
      os.tmpdir(),
      `autostart_result_create_${Date.now()}.txt`,
    );

    logger.info("executing PowerShell script", {
      psScriptPath,
      taskName,
      batPath,
    });

    const { error, stdout, stderr } = await runPowerShellScript(psScriptPath, [
      "-TaskName",
      taskName,
      "-BatPath",
      batPath,
      "-ResultFilePath",
      resultFilePath,
    ]);

    const result = buildScheduleResultFromStdout(stdout);
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
      { detail: `stdout: ${stdout}, stderr: ${stderr}` },
    );
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

    const result = buildScheduleResultFromStdout(stdout);
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
      { detail: `stdout: ${stdout}, stderr: ${stderr}` },
    );
  });
}

module.exports = {
  registerScheduleRoutes,
  buildScheduleResultFromStdout,
};
