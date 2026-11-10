import { useRefreshRevision } from "./refresh";
import { useEffect, useId, useState } from "react";
import { References } from "./References";
import { StudioCompanion } from "./StudioCompanion";

type ImageSubject = { id: string; name: string; description: string; kind?: "character" | "scene" | "image" };

export function ImageWorkspace({ projectId, kind = "character", onAddCharacter }: { projectId: string; kind?: "character" | "image"; onAddCharacter?: string }) {
  const refreshRevision = useRefreshRevision();
  const searchId = useId();
  const [subjects, setSubjects] = useState<ImageSubject[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const url = `${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}/characters`;
  const subjectType = kind === "image" ? "插画" : "角色";

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    fetch(url, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`${subjectType}列表加载失败`);
        const data = await response.json() as { items: ImageSubject[] };
        if (controller.signal.aborted) return;
        const items = data.items.filter(item => (item.kind ?? "character") === kind);
        setSubjects(items);
        setSelected(previous => items.some(item => item.id === previous) ? previous : items[0]?.id ?? "");
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "连接失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, attempt, refreshRevision, kind, subjectType]);

  const subject = subjects.find(item => item.id === selected);
  const matches = subjects.filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="image-workspace">
    <aside className="workspace-sidebar">
      <p className="eyebrow">SUBJECTS / {subjects.length}</p>
      <h2>{subjectType}列表</h2>
      <label htmlFor={searchId}>搜索{subjectType}</label>
      <input id={searchId} value={query} onChange={event => setQuery(event.target.value)} placeholder={`${subjectType}名称`} />
      {loading && <p role="status">加载中…</p>}
      {error && <div role="alert"><p>{error}</p><button onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>重新加载</button></div>}
      {query.trim() && !matches.length && !loading && <p>没有匹配的{subjectType}。</p>}
      <nav aria-label={`${subjectType}列表`}>{matches.map(item =>
        <button key={item.id} aria-pressed={selected === item.id} onClick={() => {
          if (selected !== item.id && window.confirm(`切换${subjectType}会关闭当前编辑区，请先保存需要的结果。是否继续？`)) setSelected(item.id);
        }}>{item.name}</button>
      )}</nav>
      {kind === "image" && <form className="subject-create" onSubmit={async event => {
        event.preventDefault();
        if (saving || !name.trim()) return;
        setSaving(true); setSaveError("");
        try {
          const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), description: "", kind }) });
          if (!response.ok) throw new Error("创建插画条目失败，请重试。");
          const item = await response.json() as ImageSubject;
          setSubjects(previous => [item, ...previous.filter(subject => subject.id !== item.id)]);
          if (!selected) setSelected(item.id);
          setName(""); setQuery("");
        } catch (cause) { setSaveError(String(cause)); }
        finally { setSaving(false); }
      }}>
        <label>新插画名称<input required maxLength={120} value={name} onChange={event => setName(event.target.value)} placeholder="例如：相遇 CG" /></label>
        <button disabled={saving || !name.trim()}>{saving ? "正在创建…" : "＋ 新建插画"}</button>
        {saveError && <p role="alert">{saveError}</p>}
      </form>}
      {onAddCharacter && <a href={onAddCharacter}>＋ 管理角色档案</a>}
      <p className="workspace-hint">导入素材或生成候选 → 设为母版 → 局部合成 → 导出</p>
      {kind === "character" && <StudioCompanion />}
    </aside>
    <section className="workspace-content">
      {subject ? <>
        <header className="workspace-header"><div><p className="eyebrow">IMAGE WORKSPACE</p><h2>{subject.name}</h2></div><span className="status">{subjectType}素材</span></header>
        {subject.description && <details><summary>{subjectType}设定</summary><p style={{ whiteSpace: "pre-wrap" }}>{subject.description}</p></details>}
        <References key={subject.id} projectId={projectId} characterId={subject.id} />
      </> : !loading && !error && <div className="workspace-empty">
        <h2>开始制作{subjectType}素材</h2>
        <p>{kind === "image" ? "创建插画条目后，即可导入图片、生成候选或制作局部合成。" : "创建角色档案后，即可生成立绘或编辑表情差分。"}</p>
        {onAddCharacter && <a href={onAddCharacter}>前往角色档案 →</a>}
      </div>}
    </section>
  </div>;
}
