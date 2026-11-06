import { useEffect, useRef, useState } from "react";

type Job = { input?: { prompt: string; provider: string; model: string; size: string; reference_id?: string; workflow?: Record<string, unknown> }; id: string; state: string; error?: string; outputs: string[]; approved: Record<string, string> };
export function GenerationPanel({ projectId, characterId, referenceId, initialPrompt = "", onApproved, onEdit }: {
  projectId: string; characterId: string; referenceId?: string; initialPrompt?: string; onApproved: () => Promise<void>;
  onEdit: (image: string, name: string) => Promise<void>;
}) {
  const submission = useRef<{ signature: string; id: string } | undefined>(undefined);
  const [referenceOverride, setReferenceOverride] = useState<string>();
  const activeReference = referenceOverride ?? referenceId;
  const [variants, setVariants] = useState<string[]>([]);
  const [provider, setProvider] = useState("openai");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState(initialPrompt);
  const [size, setSize] = useState("1024x1024");
  const [workflow, setWorkflow] = useState("");
  const [useReference, setUseReference] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState("");
  const [configured, setConfigured] = useState<Record<string, boolean>>({});
  const [draftReady, setDraftReady] = useState(false);
  const draftKey = `generation-draft:${projectId}:${characterId}`;
  useEffect(() => {
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      if (draft) {
        if (["openai", "seedream", "comfyui"].includes(draft.provider)) setProvider(draft.provider);
        if (typeof draft.model === "string") setModel(draft.model);
        if (typeof draft.prompt === "string") setPrompt(draft.prompt);
        if (typeof draft.size === "string") setSize(draft.size);
        if (typeof draft.workflow === "string") setWorkflow(draft.workflow);
      }
    } catch { /* Invalid drafts do not prevent opening the workspace. */ }
    setDraftReady(true);
    fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/image-services`).then(async response => {
      if (!response.ok) throw new Error("服务配置读取失败");
      setConfigured(await response.json());
    }).catch(cause => setError(String(cause)));
  }, [draftKey]);
  useEffect(() => {
    if (!draftReady) return;
    try { localStorage.setItem(draftKey, JSON.stringify({ provider, model, prompt, size, workflow })); }
    catch { setError("浏览器无法保存草稿，请在离开前复制提示词。"); }
  }, [draftReady, draftKey, provider, model, prompt, size, workflow]);
  const url = `${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}/characters/${characterId}/generation`;
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("任务列表加载失败");
        const data = await response.json();
        if (!controller.signal.aborted) setJobs(data.items);
      } catch (cause) {
        if (!controller.signal.aborted) setError(String(cause));
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 3000);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [url]);
  const states: Record<string, string> = { queued: "等待执行", running: "生成中", awaiting_review: "等待确认", reconcile_required: "需要核对服务记录", cancelled: "已取消", approved: "已确认入库" };
  return <section className="generation-panel"><div className="generation-heading"><h3>AI 图片生成</h3><span>从描述到候选素材</span></div>
    <div className="generation-layout">
    <aside className="generation-controls">
    <form className="character-form" onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true); setError("");
      try {
        if (variants.length && (!activeReference || !useReference)) throw new Error("批量变体必须引用母版");
        const prompts = variants.length ? variants.map(variant => `${prompt}。本次变化：${variant}。保持母版构图、身份、服装与其他物件不变。`) : [prompt];
        for (const nextPrompt of prompts) {
          const input = { provider, model, prompt: nextPrompt, size,
            ...(useReference && activeReference ? { reference_id: activeReference } : {}),
            ...(provider === "comfyui" ? { workflow: JSON.parse(workflow) } : {}) };
          const signature = JSON.stringify(input);
          if (submission.current?.signature !== signature) submission.current = { signature, id: crypto.randomUUID() };
          const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, request_id: submission.current.id }) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.message ?? "提交失败");
          submission.current = undefined;
          setJobs(previous => [data, ...previous.filter(job => job.id !== data.id)]);
          if (variants.length) setVariants(previous => previous.filter(variant => !nextPrompt.includes(`本次变化：${variant}。`)));
        }
      } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
    }}>
      <label>生成服务<select value={provider} disabled={busy} onChange={event => setProvider(event.target.value)}>
        <option value="openai">OpenAI 兼容 API</option><option value="seedream">字节 Seedream</option><option value="comfyui">ComfyUI</option>
      </select></label>
      <button type="button" disabled={busy} onClick={async () => {
        setBusy(true); setConnection("正在检测连接…");
        try {
          const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/image-services/${provider}/test`, { method: "POST" });
          const data = await response.json();
          setConnection(data.message);
        } catch { setConnection("无法连接本地后端，请检查服务是否启动。"); }
        finally { setBusy(false); }
      }}>检测服务连接</button>
      {connection && <p role="status">{connection}</p>}
      <p role="status">{configured[provider] ? "后端配置已就绪，提交后会连接服务。" : "服务未配置或配置状态尚未读取。请在 .env 中填写对应服务配置并重启。"}</p>
      {provider !== "comfyui" ? <>
        <label>模型 ID<input required value={model} onChange={event => setModel(event.target.value)} placeholder="填写服务提供的模型 ID" /></label>
        <label>输出尺寸<input required value={size} onChange={event => setSize(event.target.value)} /></label>
      </> : <>
        <label>导入 API 格式工作流<input type="file" accept=".json" onChange={async event => {
          const file = event.target.files?.[0];
          if (file && file.size <= 500000) setWorkflow(await file.text());
          else setError("工作流不能超过 500KB");
        }} /></label>
        <p>将工作流中提示词输入值改为 {"{{prompt}}"}，参考图文件名改为 {"{{image}}"}。使用 API 格式 JSON，并包含保存图片节点。</p>
        <label>工作流 JSON<textarea required value={workflow} onChange={event => setWorkflow(event.target.value)} rows={6} /></label>
      </>}
      <fieldset disabled={busy || !activeReference || !useReference}><legend>从母版批量制作（每项独立任务）</legend>{["平静", "开心", "悲伤", "生气", "惊讶", "害羞", "黄昏", "夜晚", "雨天"].map(variant => <label key={variant}><input type="checkbox" checked={variants.includes(variant)} onChange={e => setVariants(previous => e.target.checked ? [...previous, variant] : previous.filter(item => item !== variant))} />{variant}</label>)}<p>本次 {variants.length || 1} 个候选；批量按各子任务分别计费。</p></fieldset>
      <label>提示词<textarea required maxLength={16000} value={prompt} onChange={event => setPrompt(event.target.value)} rows={4} /></label>
      <label><input type="checkbox" checked={Boolean(activeReference) && useReference} onChange={event => setUseReference(event.target.checked)} disabled={!activeReference} />使用参考母版</label>
      {referenceOverride && <p>复用历史母版：{referenceOverride} <button type="button" onClick={() => setReferenceOverride(undefined)}>改用当前母版</button></p>}
      {!activeReference && <p>当前没有标准参考图，将进行文生图。图生图请先在素材库设置母版。</p>}
      <p>提交会调用所选服务，API 服务可能产生费用。模型与尺寸需符合该服务支持范围。</p>
      <button disabled={busy || !prompt.trim() || !configured[provider]}>{busy ? "提交中…" : "提交生成"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    </aside>
    <div className="generation-results">
    <h3>生成任务与候选</h3>
    {!jobs.length && <p>暂无生成任务。填写提示词后提交，结果会显示在这里。</p>}
    {jobs.map(job => <article className="card" key={job.id}><h4>{states[job.state] ?? job.state}</h4><small>{job.id}</small><p>{job.input?.prompt}</p>
      {job.state === "queued" && <button disabled={busy} onClick={async () => { try { const r = await fetch(`${url}/${job.id}/cancel`, { method: "POST" }); if (!r.ok) throw new Error((await r.json()).message); const item = await r.json(); setJobs(previous => previous.map(j => j.id === item.id ? item : j)); } catch(e) { setError(String(e)); } }}>取消排队</button>}
      {job.input && <button disabled={busy} onClick={() => { setPrompt(job.input!.prompt); setProvider(job.input!.provider); setModel(job.input!.model); setSize(job.input!.size); setVariants([]); setReferenceOverride(job.input!.reference_id); setUseReference(Boolean(job.input!.reference_id)); if (job.input!.workflow) setWorkflow(JSON.stringify(job.input!.workflow, null, 2)); }}>复用参数 / 单项重做</button>}
      {job.error && <p role="alert">{job.error}</p>}
      <div className="grid">{job.outputs.map((image, index) => <div key={index}>
        <img className="composite-preview" src={image} alt={`生成候选 ${index + 1}`} />
        <a href={image} download={`candidate-${index + 1}.${image.startsWith("data:image/jpeg") ? "jpg" : image.startsWith("data:image/webp") ? "webp" : "png"}`}>下载候选</a>{" "}
        <button disabled={busy || !referenceId} onClick={async () => {
          setBusy(true); setError("");
          try { await onEdit(image, `候选-${index + 1}`); }
          catch (cause) { setError(String(cause)); } finally { setBusy(false); }
        }}>送入局部合成</button>{" "}
        <button disabled={busy || Boolean(job.approved[index])} onClick={async () => {
          setBusy(true); setError("");
          try {
            const response = await fetch(`${url}/${job.id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ index }) });
            if (!response.ok) throw new Error("入库失败");
            const approved = await response.json();
            setJobs(previous => previous.map(item => item.id === job.id ? { ...item, approved: { ...item.approved, [index]: approved.id } } : item));
            await onApproved();
          } catch(cause) { setError(String(cause)); } finally { setBusy(false); }
        }}>{job.approved[index] ? "已入库" : "确认入库"}</button>
      </div>)}</div>
    </article>)}
    </div></div>
  </section>;
}
