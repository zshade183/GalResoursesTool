import { JobRecordAction } from "./JobRecordAction";
import { useRefreshRevision } from "./refresh";
import { useEffect, useRef, useState } from "react";
type Job = { duration_seconds?: number; id: string; state: string; error?: string; approved: boolean; loop_verified: boolean; provider_id?: string; input: { provider?: string; model?: string; prompt: string; duration: number; loop_intent: boolean } };
type Source = { character_id: string; reference_id: string; name: string; image: string; standard: boolean };
type Profile = "standard" | "agent-plan";
type ArkModel = { id: string; family: string; modes: string[]; durationMin: number; durationMax: number; resolutions: string[]; maxImages: number; maxVideos: number; audio: boolean };
type VideoServices = { runway: boolean; ffmpeg: boolean; ark?: Partial<Record<Profile, { configured: boolean; model?: string; error?: string; models: ArkModel[] }>> };
const modeNames: Record<string, string> = { text: "文生视频", first: "图生视频 · 首帧", frames: "图生视频 · 首尾帧", reference: "参考素材生视频", edit: "视频编辑", extend: "视频延长" };
const lines = (value: string) => value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
export const VIDEO_PROMPT_LIMIT = 850;
export function VideoWorkspace({ projectId, prompt, onPromptChange }: {
  projectId: string; prompt: string; onPromptChange: (prompt: string) => void;
}) {
  const refreshRevision = useRefreshRevision();
  const base = `${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}`;
  const [sources, setSources] = useState<Source[]>([]), [source, setSource] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [duration, setDuration] = useState(5), [ratio, setRatio] = useState("1280:720"), [camera, setCamera] = useState("fixed");
  const [services, setServices] = useState<VideoServices>();
  const [providerOverride, setProvider] = useState<"runway" | "seedance">();
  const [profileOverride, setProfile] = useState<Profile>();
  const [modelId, setModelId] = useState("");
  const [modeId, setModeId] = useState("text");
  const [arkDuration, setArkDuration] = useState(5);
  const [arkRatio, setArkRatio] = useState("adaptive");
  const [resolution, setResolution] = useState("720p");
  const [generateAudio, setGenerateAudio] = useState(false);
  const [lastSource, setLastSource] = useState("");
  const [localReferences, setLocalReferences] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState(""), [videoUrls, setVideoUrls] = useState(""), [audioUrls, setAudioUrls] = useState("");
  const [connection, setConnection] = useState("");
  const [loop, setLoop] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<{ signature: string; id: string } | undefined>(undefined);
  async function refresh() { const response = await fetch(base + "/videos"); if (!response.ok) throw new Error("视频列表读取失败"); setJobs((await response.json()).items); }
  useEffect(() => {
    const controller = new AbortController(); const options = { signal: controller.signal };
    async function load() {
      const response = await fetch(base + "/characters", options); if (!response.ok) throw new Error("素材对象加载失败");
      const characters = (await response.json()).items as { id: string; name: string }[];
      const results = await Promise.all(characters.map(async item => {
        const r = await fetch(`${base}/characters/${item.id}/references`, options); if (!r.ok) throw new Error("参考图加载失败");
        const data = await r.json() as { standard_id?: string; items: { id: string; name: string; data_url: string }[] };
        return data.items.map(image => ({
          character_id: item.id, reference_id: image.id, name: `${item.name} / ${image.name}`,
          image: image.data_url, standard: image.id === data.standard_id,
        }));
      }));
      if (!controller.signal.aborted) setSources(results.flat());
      const service = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/video-services`, options);
      if (!service.ok) throw new Error("服务配置加载失败");
      const config = await service.json();
      if (!controller.signal.aborted) setServices(config);
    }
    void load().catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const r = await fetch(base + "/videos", options); if (!r.ok) throw new Error("任务加载失败"); const data = await r.json(); if (!controller.signal.aborted) setJobs(data.items); } catch(e) { if (!controller.signal.aborted) setError(String(e)); } finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5000); } }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base, refreshRevision]);
  const profile = profileOverride ?? (services?.ark?.standard?.configured || !services?.ark?.["agent-plan"]?.configured ? "standard" : "agent-plan");
  const arkService = services?.ark?.[profile];
  const provider = providerOverride ?? (arkService?.configured ? "seedance" : "runway");
  const seedance = provider === "seedance";
  const configured = seedance ? arkService?.configured : services?.runway;
  const model = arkService?.models.find(item => item.id === modelId)
    ?? arkService?.models.find(item => item.id === arkService.model)
    ?? arkService?.models[0];
  const mode = model?.modes.includes(modeId) ? modeId : "text";
  const usesFrames = mode === "first" || mode === "frames";
  const usesReferences = ["reference", "edit", "extend"].includes(mode);
  const adaptiveOnly = model?.family === "2.5" && (usesFrames || mode === "edit" || mode === "extend");
  const fixedRatioRequired = model?.family === "1.0" && mode === "text";
  const outputRatio = adaptiveOnly ? "adaptive" : fixedRatioRequired && arkRatio === "adaptive" ? "16:9" : arkRatio;
  const outputDuration = mode === "edit" ? -1 : arkDuration;
  const availableSources = seedance ? sources : sources.filter(item => item.standard);
  const selected = availableSources.find(item => item.reference_id === source);
  const last = sources.find(item => item.reference_id === lastSource);
  const references = sources.filter(item => localReferences.includes(item.reference_id));
  const inputsReady = seedance ? Boolean(model) && (!usesFrames || Boolean(selected)) && (mode !== "frames" || Boolean(last)) : Boolean(selected);
  const pick = (item: Source) => ({ character_id: item.character_id, reference_id: item.reference_id });
  const labels: Record<string, string> = { submitting: "提交中", running: "生成中", processing: "保存视频中", awaiting_review: "待确认", approved: "已确认", failed: "失败", cancelled: "已取消", reconcile_required: "需核对供应商记录", download_failed: "下载失败，可重新查询下载" };
  async function action(id: string, name: string, loopVerified = false) {
    setBusy(true); setError(""); try { const r = await fetch(`${base}/videos/${id}/${name}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(name === "approve" ? { loop_verified: loopVerified } : {}) }); if (!r.ok) throw new Error((await r.json()).message); await refresh(); } catch(e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <section className="generation-panel generation-layout">
    <div className="generation-controls">
    <p className="eyebrow">01 / SETTINGS</p><h2>视频生成参数</h2>
    <form className="character-form" onSubmit={async event => {
      event.preventDefault();
      if (!inputsReady || busy) return;
      setBusy(true); setError("");
      const common = { prompt, camera, loop_intent: loop };
      const input = seedance ? {
        ...common, provider: "seedance", ark_profile: profile, model: model!.id, mode,
        duration: outputDuration, ratio: outputRatio,
        resolution: model!.resolutions.includes(resolution) ? resolution : "720p",
        generate_audio: model!.audio && generateAudio,
        ...(usesFrames && selected ? { first_frame: pick(selected) } : {}),
        ...(mode === "frames" && last ? { last_frame: pick(last) } : {}),
        ...(usesReferences ? { reference_images: references.map(pick), image_urls: lines(imageUrls), video_urls: lines(videoUrls), audio_urls: lines(audioUrls) } : {}),
      } : { ...common, provider: "runway", ...pick(selected!), duration, ratio };
      const signature = JSON.stringify(input); if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
      try { const r = await fetch(base + "/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: pending.current.id }) }); const data = await r.json(); if (!r.ok) throw new Error(data.message); pending.current = undefined; await refresh(); } catch(e) { setError(String(e)); } finally { setBusy(false); }
    }}>
      <label>动作描述<textarea required maxLength={VIDEO_PROMPT_LIMIT} rows={3} value={prompt} onChange={e => onPromptChange(e.target.value)} placeholder="例如：雨滴和窗外灯光轻微变化，保持建筑布局" /></label>
      <label>生成服务<select value={provider} disabled={busy} onChange={event => setProvider(event.target.value as "runway" | "seedance")}>
        <option value="seedance">火山方舟 Seedance</option><option value="runway">Runway Gen-4 Turbo</option>
      </select></label>
      {seedance && <fieldset>
        <legend>方舟模型与任务</legend>
        <label>账号类型<select value={profile} onChange={event => { setProfile(event.target.value as Profile); setConnection(""); setModelId(""); setModeId("text"); setArkDuration(5); }}>
          <option value="standard">普通方舟</option><option value="agent-plan">Agent Plan</option>
        </select></label>
        <label>模型<select value={model?.id ?? ""} onChange={event => { setModelId(event.target.value); setConnection(""); setModeId("text"); setArkDuration(5); }}>
          {arkService?.models.map(item => <option key={item.id}>{item.id}</option>)}
        </select></label>
        <label>生成方式<select value={mode} onChange={event => setModeId(event.target.value)}>
          {model?.modes.map(item => <option value={item} key={item}>{modeNames[item]}</option>)}
        </select></label>
        {model && <p>当前模型支持 {model.durationMin} 至 {model.durationMax} 秒及 {model.resolutions.join(" / ")}。模型开通状态以方舟为准。</p>}
        <button type="button" disabled={busy || !configured} onClick={async () => {
          setBusy(true); setConnection("正在检测方舟配置…");
          try {
            const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/image-services/seedream/test?profile=${profile}`, { method: "POST" });
            const data = await response.json() as { message?: string; visibleModels?: string[] };
            const listed = data.visibleModels && model && !model.id.startsWith("ep-") ? data.visibleModels.includes(model.id) : undefined;
            setConnection([data.message, listed === undefined ? undefined : listed ? "所选模型出现在可见列表中。" : "可见列表未返回所选模型。"].filter(Boolean).join(" "));
          } catch { setConnection("无法读取方舟检测结果，请检查后端连接。"); }
          finally { setBusy(false); }
        }}>检测方舟连接</button>
        {connection && <p role="status">{connection}</p>}
        {usesReferences && <>
          <label>本地参考图<select multiple value={localReferences} onChange={event => setLocalReferences(Array.from(event.target.selectedOptions, option => option.value))}>
            {sources.map(item => <option value={item.reference_id} key={item.reference_id}>{item.name}</option>)}
          </select></label>
          <label>参考图链接<textarea rows={2} value={imageUrls} onChange={event => setImageUrls(event.target.value)} placeholder="每行一个公网 HTTPS 链接或 asset:// 素材 ID" /></label>
          <label>参考视频链接<textarea rows={2} required={mode === "edit" || mode === "extend"} value={videoUrls} onChange={event => setVideoUrls(event.target.value)} placeholder="每行一个公网 MP4/MOV 链接或 asset:// 素材 ID" /></label>
          <label>参考音频链接<textarea rows={2} value={audioUrls} onChange={event => setAudioUrls(event.target.value)} placeholder="每行一个公网 WAV/MP3 链接或 asset:// 素材 ID" /></label>
          <p>方舟读取远程素材链接。请按所选模型准备素材规格，视频编辑需要 4 至 30 秒的原视频。</p>
        </>}
      </fieldset>}
      {(!seedance || usesFrames) && <>
        <label>{seedance ? "首帧" : "来源母版"}<select required value={selected?.reference_id ?? ""} onChange={event => setSource(event.target.value)}>
          <option value="">选择图片</option>{availableSources.map(item => <option key={item.reference_id} value={item.reference_id}>{item.name}</option>)}
        </select></label>
        {!availableSources.length && <p>{seedance ? "请先导入一张素材图片。" : "请先在角色或场景档案设置标准参考图。"}</p>}
        {selected && <img className="composite-preview" src={selected.image} alt="所选首帧" />}
      </>}
      {seedance && mode === "frames" && <label>尾帧<select required value={lastSource} onChange={event => setLastSource(event.target.value)}>
        <option value="">选择图片</option>{sources.map(item => <option key={item.reference_id} value={item.reference_id}>{item.name}</option>)}
      </select></label>}
      <label>镜头<select value={camera} onChange={e => setCamera(e.target.value)}><option value="fixed">固定镜头</option><option value="moving">平稳移动</option></select></label>
      {seedance && model ? <>
        <label>时长<select value={outputDuration} disabled={mode === "edit"} onChange={e => setArkDuration(Number(e.target.value))}>
          {model.family !== "1.0" && <option value={-1}>由模型决定（按最长时长预留预算）</option>}
          {Array.from({ length: model.durationMax - model.durationMin + 1 }, (_, index) => model.durationMin + index).map(seconds => <option value={seconds} key={seconds}>{seconds} 秒</option>)}
        </select></label>
        <label>画幅<select value={outputRatio} disabled={adaptiveOnly} onChange={e => setArkRatio(e.target.value)}>
          {!fixedRatioRequired && <option value="adaptive">自适应</option>}{["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"].map(item => <option key={item}>{item}</option>)}
        </select></label>
        <label>分辨率<select value={model.resolutions.includes(resolution) ? resolution : "720p"} onChange={e => setResolution(e.target.value)}>
          {model.resolutions.map(item => <option key={item}>{item}</option>)}
        </select></label>
        {model.audio && <label><input type="checkbox" checked={generateAudio} onChange={e => setGenerateAudio(e.target.checked)} />生成同步音频</label>}
      </> : !seedance && <>
        <label>时长<select value={duration} onChange={e => setDuration(Number(e.target.value))}><option value={5}>5 秒</option><option value={10}>10 秒</option></select></label>
        <label>画幅<select value={ratio} onChange={e => setRatio(e.target.value)}><option>1280:720</option><option>720:1280</option><option>960:960</option></select></label>
      </>}
      <label><input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />希望循环播放（需人工检验接缝）</label>
      <p>每次生成一个候选。提交后会把所选素材交给供应商处理，实际费用以供应商账单为准。</p>
      {!configured && <p>{seedance ? arkService?.error ?? "请在 .env 配置所选方舟账号类型的 API Key。" : "请配置 RUNWAYML_API_SECRET 后重启后端。"}</p>}
      <button disabled={busy || !configured || !inputsReady || !prompt.trim()}>{busy ? "处理中…" : `提交${seedance ? modeNames[mode] : "图生视频"}`}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    </div>
    <div className="workbench-panel generation-results">
    <p className="eyebrow">02 / OUTPUTS</p><h2>视频候选与剪辑</h2>
    {!jobs.length && <div className="workspace-empty"><p>提交生成后，可在这里预览、检查循环接缝、剪辑和确认入库。</p></div>}
    <div className="grid">{jobs.map(job => <article className="card" key={job.id}><h3>{labels[job.state] ?? job.state}</h3><p>{job.input.prompt}</p><small>{job.input.model ?? "Runway Gen-4 Turbo"} · {job.id}</small>{job.error && <p role="alert">{job.error}</p>}
      {["approved", "awaiting_review"].includes(job.state) ? <><VideoReview url={`${base}/videos/${job.id}/file`} />
        <VideoProcessing enabled={Boolean(services?.ffmpeg)} duration={job.duration_seconds ?? job.input.duration} onSubmit={async (input) => { const r = await fetch(`${base}/videos/${job.id}/process`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); if (!r.ok) throw new Error((await r.json()).message); await refresh(); }} /><a href={`${base}/videos/${job.id}/file`} download={`${job.id}.mp4`}>下载原视频</a><p>循环状态：{job.loop_verified ? "人工已确认" : "未确认"}</p>{!job.approved && <><button disabled={busy} onClick={() => void action(job.id, "approve")}>确认入库</button><button disabled={busy} onClick={() => void action(job.id, "approve", true)}>确认入库且循环合格</button></>}</> : job.provider_id && !["cancelled", "failed"].includes(job.state) && <><button disabled={busy} onClick={() => void action(job.id, "refresh")}>重新查询 / 保存</button>{job.input.provider === "seedance" ? <a href="https://ark.volcengine.com/region:cn-beijing" target="_blank" rel="noreferrer">在方舟查看任务</a> : <button disabled={busy} onClick={() => void action(job.id, "cancel")}>取消任务</button>}</>}
      <JobRecordAction url={`${base}/videos/${job.id}`} state={job.state} disabled={busy}
        onChanged={() => setJobs(previous => previous.filter(item => item.id !== job.id))} />
    </article>)}</div></div>
  </section>;
}
function VideoReview({ url }: { url: string }) {
  const video = useRef<HTMLVideoElement>(null); const [frames, setFrames] = useState<string[]>([]); const [error, setError] = useState("");
  return <><video ref={video} src={url} controls loop preload="metadata" onError={() => setError("此浏览器无法播放该编码。可下载原文件，或使用 FFmpeg 转为 H.264。")} style={{ width: "100%" }} /><button onClick={async () => {
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
