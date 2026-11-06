import { useRefreshRevision } from "./refresh";
import { useEffect, useState } from "react";
import { References } from "./References";
import { StudioCompanion } from "./StudioCompanion";

type Character = { id: string; name: string; description: string };

export function ImageWorkspace({ projectId }: { projectId: string }) {
  const refreshRevision = useRefreshRevision();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const base = import.meta.env.VITE_API_BASE_URL ?? "";
    fetch(`${base}/v1/projects/${projectId}/characters`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("角色列表加载失败");
        const data = await response.json() as { items: Character[] };
        if (controller.signal.aborted) return;
        setCharacters(data.items);
        setSelected(previous => data.items.some(item => item.id === previous) ? previous : data.items[0]?.id ?? "");
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "连接失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [projectId, attempt, refreshRevision]);

  const character = characters.find(item => item.id === selected);
  return <div className="image-workspace">
    <aside className="workspace-sidebar">
      <h2>素材对象</h2>
      <label htmlFor="character-search">搜索角色</label>
      <input id="character-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="角色名称" />
      {loading && <p role="status">加载中…</p>}
      {error && <div role="alert"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>重新加载</button></div>}
      <nav aria-label="角色列表">{characters.filter(item => item.name.includes(query.trim())).map(item =>
        <button key={item.id} aria-pressed={selected === item.id} onClick={() => {
          if (selected !== item.id && window.confirm("切换角色会关闭当前编辑区，请先保存需要的结果。是否继续？")) setSelected(item.id);
        }}>{item.name}</button>
      )}</nav>
      <p className="workspace-hint">导入参考图 → 选定母版 → 圈选区域 → 导入差分 → 合成与保存</p>
      <StudioCompanion />
    </aside>
    <section className="workspace-content">
      {character ? <>
        <header className="workspace-header"><div><p className="eyebrow">IMAGE WORKSPACE</p><h2>{character.name}</h2></div><span className="status">本地图片处理</span></header>
        <details><summary>角色设定</summary><p style={{ whiteSpace: "pre-wrap" }}>{character.description || "尚未填写角色设定"}</p></details>
        <References key={character.id} projectId={projectId} characterId={character.id} />
      </> : !loading && !error && <div className="workspace-empty"><h2>开始制作角色素材</h2><p>先在“角色档案”中创建角色，再回到这里导入参考图。</p></div>}
    </section>
  </div>;
}
