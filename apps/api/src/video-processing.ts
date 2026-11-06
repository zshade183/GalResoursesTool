import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
function run(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, { windowsHide: true, stdio: "ignore", shell: false });
    const timer = setTimeout(() => { child.kill(); reject(new Error("视频处理超时")); }, 120000);
    child.on("error", () => { clearTimeout(timer); reject(new Error("未找到 FFmpeg，请安装并配置 FFMPEG_PATH")); });
    child.on("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("视频无法解码或处理失败")); });
  });
}
export async function ffmpegAvailable() { try { await run(["-version"]); return true; } catch { return false; } }
export async function processVideo(bytes: Buffer, start: number, end: number, mute: boolean) {
  const directory = await mkdtemp(join(tmpdir(), "gal-video-"));
  try {
    const input = join(directory, "input.mp4"), output = join(directory, "output.mp4");
    await writeFile(input, bytes);
    await run(["-nostdin", "-v", "error", "-i", input, "-ss", String(start), "-t", String(end - start), "-map", "0:v:0", ...(mute ? ["-an"] : ["-map", "0:a?", "-c:a", "aac"]), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-movflags", "+faststart", output]);
    if ((await stat(output)).size > 100 * 1024 * 1024) throw new Error("处理结果超过 100MB");
    return await readFile(output);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
