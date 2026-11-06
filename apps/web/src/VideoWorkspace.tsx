import { useRefreshRevision } from "./refresh";
import { useEffect, useRef, useState } from "react";
type Job = { duration_seconds?: number; id: string; state: string; error?: string; approved: boolean; loop_verified: boolean; provider_id?: string; input: { prompt: string; duration: number; loop_intent: boolean } };
type Source = { id: string; name: string; reference: string; image: string };
export function VideoWorkspace({ projectId }: { projectId: string }) {
  const refreshRevision = useRefreshRevision();
  const base = `${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}`;
  const [sources, setSources] = useState<Source[]>([]), [source, setSource] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]), [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5), [ratio, setRatio] = useState("1280:720"), [camera, setCamera] = useState("fixed");
  const [processing, setProcessing] = useState(false);
  const [loop, setLoop] = useState(false), [configured, setConfigured] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<{ signature: string; id: string } | undefined>(undefined);
  async function refresh() { const response = await fetch(base + "/videos"); if (!response.ok) throw new Error("视频列表读取失败"); setJobs((await response.json()).items); }
  useEffect(() => {
    const controller = new AbortController(); const options = { signal: controller.signal };
    async function load() {
      const response = await fetch(base + "/characters", options); if (!response.ok) throw new Error("素材对象加载失败");
      const characters = (await response.json()).items as { id: string; name: string }[];
      const results = await Promise.all(characters.map(async item => {
        const r = await fetch(`${base}/characters/${item.id}/references`, options); if (!r.ok) throw new Error("参考图加载失败");
        const data = await r.json(); const image = data.items.find((i: { id: string }) => i.id === data.standard_id);
        return image ? { id: item.id, name: item.name, reference: image.id, image: image.data_url } as Source : undefined;
      }));
      if (!controller.signal.aborted) setSources(results.filter((item): item is Source => Boolean(item)));
      const service = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/video-services`, options); if (!service.ok) throw new Error("服务配置加载失败");
      const config = await service.json(); if (!controller.signal.aborted) { setConfigured(config.runway); setProcessing(config.ffmpeg); }
    }
    void load().catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const r = await fetch(base + "/videos", options); if (!r.ok) throw new Error("任务加载失败"); const data = await r.json(); if (!controller.signal.aborted) setJobs(data.items); } catch(e) { if (!controller.signal.aborted) setError(String(e)); } finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5000); } }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base, refreshRevision]);
  const selected = sources.find(item => item.id === source);
  const labels: Record<string, string> = { submitting: "提交中", running: "生成中", processing: "保存视频中", awaiting_review: "待确认", approved: "已确认", failed: "失败", cancelled: "已取消", reconcile_required: "需核对供应商记录", download_failed: "下载失败，可重新查询下载" };
  async function action(id: string, name: string, loopVerified = false) {
    setBusy(true); setError(""); try { const r = await fetch(`${base}/videos/${id}/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(name === "approve" ? { loop_verified: loopVerified } : {}) }); if (!r.ok) throw new Error((await r.json()).message); await refresh(); } catch(e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <section className="generation-panel"><h2>视频工作台</h2><p>从已确认母版制作动态背景或动态 CG。结果先进入候选，确认后成为正式素材。</p>
    <form className="character-form" onSubmit={async event => {
      event.preventDefault(); if (!selected || busy) return; setBusy(true); setError("");
      const input = { character_id: selected.id, reference_id: selected.reference, prompt, duration, ratio, camera, loop_intent: loop };
      const signature = JSON.stringify(input); if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
      try { const r = await fetch(base + "/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: pending.current.id }) }); const data = await r.json(); if (!r.ok) throw new Error(data.message); pending.current = undefined; await refresh(); } catch(e) { setError(String(e)); } finally { setBusy(false); }
    }}>
      <label>来源母版<select required value={source} onChange={event => setSource(event.target.value)}><option value="">选择角色或场景</option>{sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {!sources.length && <p>请先在角色或场景档案导入图片，并设为标准参考图。</p>}
      {selected && <img className="composite-preview" src={selected.image} alt="来源母版" />}
      <label>动作描述<textarea required maxLength={850} rows={3} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="例如：雨滴和窗外灯光轻微变化，保持建筑布局" /></label>
      <label>镜头<select value={camera} onChange={e => setCamera(e.target.value)}><option value="fixed">固定镜头</option><option value="moving">平稳移动</option></select></label>
      <label>时长<select value={duration} onChange={e => setDuration(Number(e.target.value))}><option value={5}>5 秒</option><option value={10}>10 秒</option></select></label>
      <label>画幅<select value={ratio} onChange={e => setRatio(e.target.value)}><option>1280:720</option><option>720:1280</option><option>960:960</option></select></label>
      <label><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />希望循环播放（需人工检验接缝）</label>
      <p>Runway · gen4_turbo · 每次 1 个候选。提交会向服务传输母版并产生费用，实际费用以供应商账单为准。</p>
      {!configured && <p>请配置 RUNWAYML_API_SECRET 后重启后端。</p>}
      <button disabled={busy || !configured || !selected || !prompt.trim()}>{busy ? "处理中…" : "提交图生视频"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <div className="grid">{jobs.map(job => <article className="card" key={job.id}><h3>{labels[job.state] ?? job.state}</h3><p>{job.input.prompt}</p><small>{job.id}</small>{job.error && <p role="alert">{job.error}</p>}
      {["approved", "awaiting_review"].includes(job.state) ? <><VideoReview url={`${base}/videos/${job.id}/file`} />
        <VideoProcessing enabled={processing} duration={job.duration_seconds ?? job.input.duration} onSubmit={async (input) => { const r = await fetch(`${base}/videos/${job.id}/process`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); if (!r.ok) throw new Error((await r.json()).message); await refresh(); }} /><a href={`${base}/videos/${job.id}/file`} download={`${job.id}.mp4`}>下载原视频</a><p>循环状态：{job.loop_verified ? "人工已确认" : "未确认"}</p>{!job.approved && <><button disabled={busy} onClick={() => void action(job.id, "approve")}>确认入库</button><button disabled={busy} onClick={() => void action(job.id, "approve", true)}>确认入库且循环合格</button></>}</> : job.provider_id && !["cancelled", "failed"].includes(job.state) && <><button disabled={busy} onClick={() => void action(job.id, "refresh")}>重新查询 / 保存</button><button disabled={busy} onClick={() => void action(job.id, "cancel")}>取消任务</button></>}
    </article>)}</div>
  </section>;
}
function VideoReview({ url }: { url: string }) {
  const video = useRef<HTMLVideoElement>(null); const [frames, setFrames] = useState<string[]>([]); const [error, setError] = useState("");
  return <><video ref={video} src={url} controls loop muted preload="metadata" style={{ width: "100%" }} /><button onClick={async () => {
    const v = video.current; if (!v || !Number.isFinite(v.duration)) return; v.pause(); setError("");
    try { const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = Math.round(320 * v.videoHeight / v.videoWidth); const ctx = canvas.getContext("2d")!; const result: string[] = [];
      for (const time of [0.01, v.duration / 2, Math.max(0, v.duration - 0.1)]) { await new Promise<void>((resolve, reject) => { const timeout = setTimeout(() => { v.onseeked = null; reject(new Error("抽帧超时")); }, 10000); v.onseeked = () => { clearTimeout(timeout); v.onseeked = null; resolve(); }; v.currentTime = time; }); ctx.drawImage(v, 0, 0, canvas.width, canvas.height); result.push(canvas.toDataURL("image/png")); } setFrames(result);
    } catch(e) { setError(String(e)); }
  }}>检查首帧 / 中间帧 / 尾帧</button><div className="grid">{frames.map((frame, index) => <img key={index} src={frame} alt={["首帧", "中间帧", "尾帧"][index]} style={{ width: "100%" }} />)}</div>{error && <p role="alert">{error}</p>}</>;
}

function VideoProcessing({ enabled, duration, onSubmit }: { enabled: boolean; duration: number; onSubmit: (input: { start: number; end: number; mute: boolean }) => Promise<void> }) {
  const [start, setStart] = useState(0), [end, setEnd] = useState(duration), [mute, setMute] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <details><summary>裁剪 / 静音 / 转换为 H.264 MP4</summary><p>处理结果另存为候选版本，原文件保留。{!enabled && "需要安装 FFmpeg 并配置 FFMPEG_PATH。"}</p><label>开始秒数<input type="number" min={0} max={duration} step={0.1} value={start} onChange={e => setStart(Number(e.target.value))} /></label><label>结束秒数<input type="number" min={0} max={duration} step={0.1} value={end} onChange={e => setEnd(Number(e.target.value))} /></label><label><input type="checkbox" checked={mute} onChange={e => setMute(e.target.checked)} />移除音轨</label><button disabled={!enabled || busy || end <= start} onClick={async () => { setBusy(true); setError(""); try { await onSubmit({ start, end, mute }); } catch(e) { setError(String(e)); } finally { setBusy(false); } }}>保存处理版本</button>{error && <p role="alert">{error}</p>}</details>;
}
