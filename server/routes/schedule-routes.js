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
  const { path, os, exec, baseDir, apiOk, apiError } = deps;

  app.post("/api/schedule/create", (_req, res) => {
    const taskName = "YoutubeDL-AutoStart";
    const batPath = path.resolve(baseDir, "起動.bat");
    const psScriptPath = path.resolve(baseDir, "create_autostart_task.ps1");
    const resultFilePath = path.join(
      os.tmpdir(),
      `autostart_result_create_${Date.now()}.txt`,
    );

    const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}" -TaskName "${taskName}" -BatPath "${batPath}" -ResultFilePath "${resultFilePath}"`;
    console.log(`Executing PowerShell command: ${command}`);

    exec(command, { shell: "powershell.exe" }, (error, stdout, stderr) => {
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
  });

  app.post("/api/schedule/delete", (_req, res) => {
    const taskName = "YoutubeDL-AutoStart";
    const psScriptPath = path.resolve(baseDir, "delete_autostart_task.ps1");
    const resultFilePath = path.join(
      os.tmpdir(),
      `autostart_result_delete_${Date.now()}.txt`,
    );

    const command = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}" -TaskName "${taskName}" -ResultFilePath "${resultFilePath}"`;
    console.log(`Executing PowerShell command: ${command}`);

    exec(command, { shell: "powershell.exe" }, (error, stdout, stderr) => {
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
  });
}

module.exports = {
  registerScheduleRoutes,
  buildScheduleResultFromStdout,
};
