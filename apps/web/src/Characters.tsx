import { useRefreshRevision } from "./refresh";
import { useEffect, useState } from "react";
import { References } from "./References";
type Character = { id: string; name: string; description: string; kind?: string };
export function Characters({ projectId, kind = "character" }: { projectId: string; kind?: "character" | "scene" }) {
  const refreshRevision = useRefreshRevision();
  const [items, setItems] = useState<Character[]>([]);
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<(Character & { version_id: string; updated_at: string })[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const url = `${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}/characters`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error("角色加载失败");
      setItems((await r.json()).items.filter((item: Character) => (item.kind ?? "character") === kind));
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, kind, refreshRevision]);
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
  }, [editing, url]);
  function reset() { setEditing(undefined); setName(""); setDescription(""); setHistory([]); }
  return <section><h2>{kind === "scene" ? "场景档案与背景生成" : "角色档案与立绘生成"}</h2>
    {loading ? <p>加载中…</p> : <div className="grid">{items.map(item => <button className="card character-card" disabled={busy} key={item.id} onClick={() => { setEditing(item.id); setName(item.name); setDescription(item.description); }}><h3>{item.name}</h3><p>{item.description.slice(0, 100) || "尚未填写设定"}</p><span>编辑设定</span></button>)}</div>}
    {!loading && !items.length && <p>还没有角色，先添加主角的名字和设定。</p>}
    <form className="character-form" onSubmit={async event => {
      event.preventDefault(); if (busy || !name.trim()) return;
      setBusy(true); setError("");
      try {
        const response = await fetch(editing ? `${url}/${editing}` : url, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description, kind }) });
        if (!response.ok) throw new Error("保存失败，请重试。");
        const item = await response.json() as Character;
        setItems(previous => [item, ...previous.filter(c => c.id !== item.id)]); reset();
      } catch (e) { setError(String(e)); } finally { setBusy(false); }
    }}><h3>{editing ? (kind === "scene" ? "编辑场景" : "编辑角色") : (kind === "scene" ? "添加场景" : "添加角色")}</h3>
      <label htmlFor="character-name">{kind === "scene" ? "场景名称" : "角色名称"}</label><input id="character-name" maxLength={120} required value={name} onChange={e => setName(e.target.value)} disabled={busy} />
      <label>导入设定文本（TXT / Markdown）<input type="file" accept=".txt,.md" disabled={busy} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 100000) throw new Error("设定文件不能超过 100KB"); const text = await file.text(); if (text.length > 20000) throw new Error("设定不能超过两万字"); setDescription(text); } catch(error) { setError(String(error)); } e.target.value = ""; }} /></label>
      <label htmlFor="character-description">{kind === "scene" ? "场景设定" : "角色设定"}</label><textarea id="character-description" rows={8} maxLength={20000} placeholder={kind === "scene" ? "布局、门窗、关键物件、常用镜头、时间与天气……" : "身份、外貌、性格、语言习惯、服装与姿态……"} value={description} onChange={e => setDescription(e.target.value)} disabled={busy} />
      <button disabled={busy || !name.trim()}>{busy ? "保存中…" : kind === "scene" ? "保存场景" : "保存角色"}</button> {editing && <button type="button" disabled={busy} onClick={reset}>取消编辑</button>}
      {error && <p role="alert">{error}</p>}
    </form>
    {editing && <section aria-label="设定历史"><h3>版本历史</h3><p>选择旧版将填入编辑区，点击“保存角色”后恢复为新版本，原有记录仍保留。</p>{historyLoading ? <p>加载中…</p> : history.map(version => <details className="card" key={version.version_id}><summary>{version.name} · {new Date(version.updated_at).toLocaleString("zh-CN")}</summary><p style={{ whiteSpace: "pre-wrap" }}>{version.description || "空设定"}</p><button disabled={busy} onClick={() => { setName(version.name); setDescription(version.description); }}>将此版本填入编辑区</button></details>)}</section>}
    {editing && <References key={editing} projectId={projectId} characterId={editing} />}
  </section>;
}
