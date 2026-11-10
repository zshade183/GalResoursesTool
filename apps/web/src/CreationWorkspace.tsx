import { useState } from "react";
import { References } from "./References";
import { VIDEO_PROMPT_LIMIT } from "./VideoWorkspace";

const presets = {
  图片: { prompt: "清晰构图，统一画风，高质量视觉小说插画", placeholder: "主体、构图、光照", hints: ["双人对话 CG", "逆光与浅景深", "特写镜头"] },
  场景: { prompt: "视觉小说背景，无人物，无文字，空间透视准确，保留对话框区域", placeholder: "地点、时代、季节、天气、时间", hints: ["同机位的昼夜变化", "留出角色站位", "层次分明的远景"] },
  视频: { prompt: "镜头运动平稳，主体外观一致，避免闪烁与形变，首尾自然衔接", placeholder: "主体动作、镜头移动、时长、节奏", hints: ["固定镜头，环境微动", "缓慢推近主体", "首尾无缝循环"] },
  角色: { prompt: "视觉小说角色立绘，全身，主体完整，服装细节一致，纯色背景，无文字", placeholder: "姓名、外貌、服装、姿势、表情", hints: ["全身三分之四视角", "保留服装与饰品细节", "同姿势表情差分"] },
};
type Kind = keyof typeof presets;
type Draft = { subject: string; style: string; details: string };

function loadDraft(key: string, kind: Kind): Draft {
  try {
    const value = JSON.parse(localStorage.getItem(`${key}:${kind}`) ?? localStorage.getItem(key) ?? "null");
    if (value?.kind === kind && [value.subject, value.style, value.details].every(item => typeof item === "string")) return value;
  } catch { /* A missing or invalid draft starts with the defaults. */ }
  return { subject: "", style: "日系动画", details: "" };
}

export function CreationWorkspace({ projectId, kinds, onUsePrompt }: {
  projectId: string; kinds: readonly Kind[]; onUsePrompt?: (prompt: string) => void;
}) {
  const [active, setActive] = useState(kinds[0]);
  return <section className="generation-panel">
    {kinds.length > 1 && <nav className="workspace-tabs" aria-label="图片方案类型">
      {kinds.map(kind => <button key={kind} aria-pressed={active === kind} onClick={() => setActive(kind)}>{kind}方案</button>)}
    </nav>}
    {kinds.map(kind => <div key={kind} hidden={kind !== active}><PromptPlan projectId={projectId} kind={kind} onUsePrompt={onUsePrompt} /></div>)}
  </section>;
}

function PromptPlan({ projectId, kind, onUsePrompt }: { projectId: string; kind: Kind; onUsePrompt?: (prompt: string) => void }) {
  const key = `creation:${projectId}`;
  const preset = presets[kind];
  const [draft, setDraft] = useState(() => loadDraft(key, kind));
  const [status, setStatus] = useState("");
  const [target, setTarget] = useState<{ id: string; name: string; prompt: string }>();
  const [busy, setBusy] = useState(false);
  const prompt = [draft.subject.trim(), draft.style.trim() && `画风：${draft.style.trim()}`, draft.details.trim(), preset.prompt].filter(Boolean).join("。\n");

  async function prepareGeneration() {
    if (busy || !draft.subject.trim()) return;
    setBusy(true);
    try {
      const name = `[${kind}] ${draft.subject.trim().slice(0, 100)}`;
      const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}/characters`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: prompt, kind: kind === "场景" ? "scene" : kind === "角色" ? "character" : "image" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "创建素材对象失败");
      setTarget({ id: data.id, name, prompt });
      setStatus("已创建素材条目。在下方选择服务并提交生成。");
    } catch (error) { setStatus(error instanceof Error ? error.message : "操作失败"); }
    finally { setBusy(false); }
  }

  function update(patch: Partial<Draft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    try { localStorage.setItem(`${key}:${kind}`, JSON.stringify({ ...next, kind })); setStatus("草稿已保存到此浏览器。"); }
    catch { setStatus("草稿保存失败，可以导出文本。"); }
  }

  return <>
    <div className="generation-layout plan-layout">
      <div className="workbench-panel character-form">
        <p className="eyebrow">01 / INPUT</p><h2>编写{kind === "视频" ? "镜头" : kind}方案</h2>
        <label>主体描述<textarea rows={4} maxLength={6000} value={draft.subject} onChange={event => update({ subject: event.target.value })} placeholder={preset.placeholder} /></label>
        <label>画风<input maxLength={200} value={draft.style} onChange={event => update({ style: event.target.value })} /></label>
        <label>补充要求<textarea rows={4} maxLength={6000} value={draft.details} onChange={event => update({ details: event.target.value })} /></label>
        <div className="prompt-hints" aria-label="补充要求模板">{preset.hints.map(hint =>
          <button key={hint} type="button" disabled={draft.details.includes(hint) || draft.details.length + hint.length + 1 > 6000} onClick={() => update({ details: [draft.details.trim(), hint].filter(Boolean).join("\n") })}>＋ {hint}</button>)}</div>
      </div>
      <div className="workbench-panel">
        <p className="eyebrow">02 / PROMPT</p><h2>提示词预览</h2>
        <pre className="prompt-preview">{prompt}</pre>
        {onUsePrompt && <p className="form-hint">{prompt.length} / {VIDEO_PROMPT_LIMIT} 字符 · 填入后会替换视频工作台的动作描述。</p>}
        <div className="prompt-actions">
          <button disabled={!draft.subject.trim()} onClick={async () => {
            try { await navigator.clipboard.writeText(prompt); setStatus(kind === "视频" ? "已复制。可粘贴到视频工作台的动作描述。" : "提示词已复制。"); }
            catch { setStatus("复制失败，请手动选择预览文字复制。"); }
          }}>复制提示词</button>
          <button disabled={!draft.subject.trim()} onClick={() => {
            const url = URL.createObjectURL(new Blob([prompt], { type: "text/plain;charset=utf-8" }));
            const link = document.createElement("a");
            link.href = url; link.download = `${kind}-提示词.txt`; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}>导出方案</button>
          {onUsePrompt && <button className="primary-action" disabled={!draft.subject.trim() || prompt.length > VIDEO_PROMPT_LIMIT} onClick={() => onUsePrompt(prompt)}>填入视频工作台</button>}
          {kind !== "视频" && <button className="primary-action" disabled={busy || !draft.subject.trim() || target?.prompt === prompt} onClick={() => void prepareGeneration()}>{busy ? "准备中…" : "创建素材并配置生成"}</button>}
        </div>
        <p role="status">{status}</p>
      </div>
    </div>
    {target && <section className="workbench-panel plan-target">
      <p className="eyebrow">03 / GENERATION</p><h2>{target.name}</h2>
      <References key={target.id} projectId={projectId} characterId={target.id} initialPanel="generate" initialPrompt={target.prompt} />
    </section>}
  </>;
}
