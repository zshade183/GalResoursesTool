import { useEffect, useState } from "react";
import type { HealthResponse } from "@gal/contracts";
import { Characters } from "./Characters";

type ApiStatus = "checking" | "online" | "offline";

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<{ id: string; name: string }>();
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

  useEffect(() => {
    fetch(`${baseUrl}/v1/projects`).then(async (response) => {
      if (!response.ok) throw new Error();
      setProjects((await response.json()).items);
    }).catch(() => setError("作品加载失败，请刷新重试。"));
  }, [baseUrl]);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
    fetch(`${baseUrl}/health`)
      .then(async (response) => {
        if (!response.ok) throw new Error("health check failed");
        return response.json() as Promise<HealthResponse>;
      })
      .then(() => setApiStatus("online"))
      .catch(() => setApiStatus("offline"));
  }, []);

  if (selected) return <main className="shell"><button onClick={() => setSelected(undefined)}>← 返回作品列表</button><h1>{selected.name}</h1><Characters key={selected.id} projectId={selected.id} /></main>;
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">GAL RESOURCES TOOL</span>
          <h1>视觉小说素材工作室</h1>
        </div>
        <span className={`status status--${apiStatus}`}>API {apiStatus}</span>
      </header>

      <section className="hero">
        <p className="eyebrow">从作品设定到可用素材包</p>
        <h2>统一制作、确认和管理你的视觉小说素材。</h2>
        <p>当前正在建设 P1 核心闭环：作品、角色、图片、视频、版本与导出。</p>
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (saving || !name.trim()) return;
          setSaving(true); setError("");
          try {
            const response = await fetch(`${baseUrl}/v1/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
            if (!response.ok) throw new Error();
            const project = await response.json();
            setProjects((items) => [project, ...items]); setName("");
          } catch { setError("创建失败，请稍后重试。"); }
          finally { setSaving(false); }
        }}>
          <label htmlFor="name">作品名称 </label>
          <input id="name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} />
          <button disabled={saving || !name.trim()}>{saving ? "创建中…" : "创建作品"}</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </section>
      <section aria-label="我的作品"><h2>我的作品</h2>{projects.map((project) => <button className="card character-card" key={project.id} onClick={() => setSelected(project)}><h3>{project.name}</h3><span>进入作品 →</span></button>)}</section>

      <section className="grid" aria-label="首版模块">
        {[
          ["角色与图片", "母版、姿态与表情差分"],
          ["场景与视频", "背景变体与图生视频"],
          ["素材版本", "来源、依赖与确认状态"],
          ["导出中心", "统一规格与素材包清单"],
        ].map(([title, description]) => (
          <article className="card" key={title}>
            <h3>{title}</h3>
            <p>{description}</p>
            <span>准备中</span>
          </article>
        ))}
      </section>
    </main>
  );
}

