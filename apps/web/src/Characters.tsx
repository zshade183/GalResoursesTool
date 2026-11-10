import { useRefreshRevision } from "./refresh";
import { useEffect, useId, useState } from "react";
import { References } from "./References";
type Character = { id: string; name: string; description: string; kind?: string };
export function Characters({ projectId, kind = "character" }: { projectId: string; kind?: "character" | "scene" }) {
  const refreshRevision = useRefreshRevision();
  const formId = useId();
  const subject = kind === "scene" ? "场景" : "角色";
  const [items, setItems] = useState<Character[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<(Character & { version_id: string; updated_at: string })[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const url = `${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}/characters`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error(`${subject}加载失败`);
      setItems((await r.json()).items.filter((item: Character) => (item.kind ?? "character") === kind));
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, kind, subject, refreshRevision]);
  useEffect(() => {
    setHistory([]);
    if (!editing) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    fetch(`${url}/${editing}/history`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("历史加载失败");
      const data = await response.json();
      if (!controller.signal.aborted) setHistory(data.items);
    }).catch(error => { if (!controller.signal.aborted) setError(String(error)); }).finally(() => { if (!controller.signal.aborted) setHistoryLoading(false); });
    return () => controller.abort();
  }, [editing, url, historyRevision]);
  function reset() { setEditing(undefined); setName(""); setDescription(""); setHistory([]); }
  const matches = items.filter(item => item.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="image-workspace">
    <aside className="workspace-sidebar">
      <p className="eyebrow">PROFILES / {items.length}</p>
      <h2>{subject}档案</h2>
      <label htmlFor={`${formId}-search`}>搜索{subject}</label>
      <input id={`${formId}-search`} value={query} onChange={event => setQuery(event.target.value)} placeholder={`${subject}名称`} />
      {loading ? <p role="status">加载中…</p> : <nav aria-label={`${subject}档案列表`}>
        {matches.map(item => <button aria-pressed={editing === item.id} disabled={busy} key={item.id} onClick={() => { setEditing(item.id); setName(item.name); setDescription(item.description); }}>{item.name}</button>)}
        {!matches.length && <p>{items.length ? "没有匹配的档案。" : `添加第一个${subject}，记录它的设定。`}</p>}
      </nav>}
      <button type="button" disabled={busy} onClick={reset}>＋ 添加{subject}</button>
    </aside>
    <section className="workspace-content">
    <header className="workspace-header"><div><p className="eyebrow">PROFILE EDITOR</p><h2>{editing ? `编辑${subject}` : `添加${subject}`}</h2></div></header>
    <form className="character-form" onSubmit={async event => {
      event.preventDefault(); if (busy || !name.trim()) return;
      setBusy(true); setError("");
      try {
        const response = await fetch(editing ? `${url}/${editing}` : url, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, kind }) });
        if (!response.ok) throw new Error("保存失败，请重试。");
        const item = await response.json() as Character;
        setItems(previous => [item, ...previous.filter(c => c.id !== item.id)]);
        setEditing(item.id); setName(item.name); setDescription(item.description); setQuery("");
        setHistoryRevision(value => value + 1);
      } catch (e) { setError(String(e)); } finally { setBusy(false); }
    }}>
      <label htmlFor={`${formId}-name`}>{subject}名称</label><input id={`${formId}-name`} maxLength={120} required value={name} onChange={e => setName(e.target.value)} disabled={busy} />
      <label>导入设定文本（TXT / Markdown）<input type="file" accept=".txt,.md" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 100000) throw new Error("设定文件不能超过 100KB"); const text = await file.text(); if (text.length > 20000) throw new Error("设定不能超过两万字"); setDescription(text); } catch(error) { setError(String(error)); } e.target.value = ""; }} /></label>
      <label htmlFor={`${formId}-description`}>{subject}设定</label><textarea id={`${formId}-description`} rows={8} maxLength={20000} placeholder={kind === "scene" ? "布局、门窗、关键物件、常用镜头、时间与天气……" : "身份、外貌、性格、语言习惯、服装与姿态……"} value={description} onChange={e => setDescription(e.target.value)} disabled={busy} />
      <button disabled={busy || !name.trim()}>{busy ? "保存中…" : kind === "scene" ? "保存场景" : "保存角色"}</button> {editing && <button type="button" disabled={busy} onClick={reset}>取消编辑</button>}
      {error && <p role="alert">{error}</p>}
    </form>
    {editing && <details aria-label="设定历史"><summary>版本历史</summary><p>选择旧版可将内容填入编辑区。保存后将生成一个新版本。</p>{historyLoading ? <p>加载中…</p> : history.map(version => <details className="card" key={version.version_id}><summary>{version.name} · {new Date(version.updated_at).toLocaleString("zh-CN")}</summary><p style={{ whiteSpace: "pre-wrap" }}>{version.description || "空设定"}</p><button disabled={busy} onClick={() => { setName(version.name); setDescription(version.description); }}>将此版本填入编辑区</button></details>)}</details>}
    {kind === "scene" && editing && <References key={editing} projectId={projectId} characterId={editing} />}
    </section>
  </div>;
}
