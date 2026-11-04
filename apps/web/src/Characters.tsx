import { useEffect, useState } from "react";
type Character = { id: string; name: string; description: string };
export function Characters({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Character[]>([]);
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const url = `${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}/characters`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error("角色加载失败");
      setItems((await r.json()).items);
    }).catch(e => { if (!controller.signal.aborted) setError(String(e)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url]);
  function reset() { setEditing(undefined); setName(""); setDescription(""); }
  return <section><h2>角色档案</h2>
    {loading ? <p>加载中…</p> : <div className="grid">{items.map(item => <button className="card character-card" disabled={busy} key={item.id} onClick={() => { setEditing(item.id); setName(item.name); setDescription(item.description); }}><h3>{item.name}</h3><p>{item.description.slice(0, 100) || "尚未填写设定"}</p><span>编辑设定</span></button>)}</div>}
    {!loading && !items.length && <p>还没有角色，先添加主角的名字和设定。</p>}
    <form className="character-form" onSubmit={async event => {
      event.preventDefault(); if (busy || !name.trim()) return;
      setBusy(true); setError("");
      try {
        const response = await fetch(editing ? `${url}/${editing}` : url, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, description }) });
        if (!response.ok) throw new Error("保存失败，请重试。");
        const item = await response.json() as Character;
        setItems(previous => [item, ...previous.filter(c => c.id !== item.id)]); reset();
      } catch (e) { setError(String(e)); } finally { setBusy(false); }
    }}><h3>{editing ? "编辑角色" : "添加角色"}</h3>
      <label htmlFor="character-name">角色名称</label><input id="character-name" maxLength={120} required value={name} onChange={e => setName(e.target.value)} disabled={busy} />
      <label htmlFor="character-description">角色设定</label><textarea id="character-description" rows={8} maxLength={20000} placeholder="身份、外貌、性格、语言习惯……" value={description} onChange={e => setDescription(e.target.value)} disabled={busy} />
      <button disabled={busy || !name.trim()}>{busy ? "保存中…" : "保存角色"}</button> {editing && <button type="button" disabled={busy} onClick={reset}>取消编辑</button>}
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;
}
