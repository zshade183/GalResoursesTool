import { VideoWorkspace } from "./VideoWorkspace";
import { useState } from "react";
import { GenerationPanel } from "./GenerationPanel";

type Kind = "图片" | "场景" | "视频" | "角色";
const presets: Record<Kind, string> = {
  图片: "清晰构图，统一画风，高质量视觉小说插画",
  场景: "视觉小说背景，无人物，无文字，空间透视准确，保留对话框区域",
  视频: "镜头运动平稳，主体外观一致，避免闪烁与形变，首尾自然衔接",
  角色: "视觉小说角色立绘，全身，主体完整，服装细节一致，纯色背景，无文字",
};
export function CreationWorkspace({ projectId }: { projectId: string }) {
  const key = `creation:${projectId}`;
  const [draft, setDraft] = useState(() => {
    try { const value = JSON.parse(localStorage.getItem(key) ?? "null");
      if (value && Object.hasOwn(presets, value.kind) && [value.subject, value.style, value.details].every(item => typeof item === "string")) return value as { kind: Kind; subject: string; style: string; details: string };
    } catch { /* Start with a fresh draft when storage is unavailable. */ }
    return { kind: "图片" as Kind, subject: "", style: "日系动画", details: "" };
  });
  const [status, setStatus] = useState("");
  const [target, setTarget] = useState<{ id: string; kind: Kind }>();
  const [busy, setBusy] = useState(false);
  async function prepareGeneration() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}/characters`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `[${draft.kind}] ${draft.subject.trim().slice(0, 100)}`, description: prompt, kind: draft.kind === "场景" ? "scene" : draft.kind === "角色" ? "character" : "image" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "创建素材对象失败");
      setTarget({ id: data.id, kind: draft.kind });
      setStatus("素材对象已创建，可在下方选择服务生成，确认后的结果进入该对象素材库。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }
  const prompt = [draft.subject.trim(), `画风：${draft.style.trim()}`, draft.details.trim(), presets[draft.kind]].filter(Boolean).join("。\n");
  function update(patch: Partial<typeof draft>) {
    const next = { ...draft, ...patch }; setDraft(next);
    try { localStorage.setItem(key, JSON.stringify(next)); setStatus("草稿已保存"); }
    catch { setStatus("草稿保存失败，请导出备份"); }
  }
  return <section className="generation-panel"><h2>生成方案工作区</h2>
    <nav className="workspace-tabs" aria-label="素材类型">{(Object.keys(presets) as Kind[]).map(kind => <button key={kind} aria-pressed={draft.kind === kind} onClick={() => update({ kind })}>{kind}生成</button>)}</nav>
    {draft.kind === "视频" && <VideoWorkspace projectId={projectId} />}
    <div className="generation-layout"><div className="character-form">
      <label>主体描述<textarea rows={4} maxLength={6000} value={draft.subject} onChange={event => update({ subject: event.target.value })} placeholder={draft.kind === "场景" ? "地点、时代、季节、天气、时间" : draft.kind === "视频" ? "主体动作、镜头移动、时长、节奏" : draft.kind === "角色" ? "姓名、外貌、服装、姿势、表情" : "主体、构图、光照"} /></label>
      <label>画风<input maxLength={200} value={draft.style} onChange={event => update({ style: event.target.value })} /></label>
      <label>补充要求<textarea rows={4} maxLength={6000} value={draft.details} onChange={event => update({ details: event.target.value })} /></label>
    </div><div><h3>生成提示词预览</h3><pre style={{ whiteSpace: "pre-wrap" }}>{prompt}</pre>
      <button disabled={!draft.subject.trim()} onClick={async () => { try { await navigator.clipboard.writeText(prompt); setStatus("提示词已复制，可粘贴到图片工作台提交"); } catch { setStatus("复制失败，请手动选择预览文字复制"); } }}>复制提示词</button>{" "}
      <button disabled={!draft.subject.trim()} onClick={() => { const url = URL.createObjectURL(new Blob([prompt], { type: "text/plain;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = `${draft.kind}-提示词.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>导出方案</button>
      <p>{draft.kind === "视频" ? "视频生成请使用上方工作台；这里可另外保存镜头方案。" : "复制提示词后，前往图片工作台选择素材对象和服务提交生成。"}</p>
      {draft.kind !== "视频" && <button disabled={busy || !draft.subject.trim()} onClick={() => void prepareGeneration()}>{busy ? "准备中…" : "创建素材对象并生成"}</button>}
      <p role="status">{status}</p>
    </div></div>
    {target && <GenerationPanel key={target.id} projectId={projectId} characterId={target.id} initialPrompt={prompt} onApproved={async () => { setStatus("已入库，可在图片工作台查看和导出。"); }} onEdit={async () => { setStatus("请在图片工作台选择该素材对象进行局部合成。"); }} />}
  </section>;
}
