const { spawn } = require("child_process");

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code}${stderr ? `: ${stderr}` : ""}`,
        ),
      );
    });
  });
}

function runCommandCapture(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true });
    const stdoutChunks = [];
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        const stdout = Buffer.concat(stdoutChunks).toString();
        resolve(stdout);
        return;
      }
      reject(
        new Error(
          `${command} exited with code ${code}${stderr ? `: ${stderr}` : ""}`,
        ),
      );
    });
  });
}

module.exports = {
  runCommand,
  runCommandCapture,
};
