import { refreshStudio } from "./refresh";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { UiWorkspace } from "./UiWorkspace";
import { StudioWorkspace } from "./StudioWorkspace";
import { TaskWorkspace } from "./TaskWorkspace";
import { VideoWorkspace } from "./VideoWorkspace";
import { CreationWorkspace } from "./CreationWorkspace";
import { useEffect, useState } from "react";
import type { HealthResponse } from "@gal/contracts";
import { Characters } from "./Characters";
import { ImageWorkspace } from "./ImageWorkspace";
import { MusicWorkspace } from "./MusicWorkspace";
import shinoPortrait from "./assets/shino-anime.png";

type ApiStatus = "checking" | "online" | "offline";
type Project = { id: string; name: string };
type WorkspaceTab = "images" | "characters" | "scenes" | "videos" | "creation" | "music" | "ui" | "conversations" | "studio" | "tasks";

const TAB_ORDER: WorkspaceTab[] = ["images", "characters", "scenes", "videos", "creation", "music", "ui", "conversations", "studio", "tasks"];
const TAB_LABELS: Record<WorkspaceTab, string> = {
  images: "图片工作台",
  characters: "角色档案",
  scenes: "场景生成",
  videos: "视频生成",
  creation: "生成方案",
  music: "音乐与音效",
  ui: "UI 素材",
  conversations: "角色对话",
  studio: "作品与资源库",
  tasks: "任务中心",
};

/** 按工作区标识渲染对应的功能面板；key 绑定作品，切换作品时整体重建。 */
function WorkspaceView({ tab, projectId }: { tab: WorkspaceTab; projectId: string }) {
  switch (tab) {
    case "conversations": return <ConversationWorkspace key={projectId} projectId={projectId} />;
    case "ui": return <UiWorkspace key={projectId} projectId={projectId} />;
    case "studio": return <StudioWorkspace key={projectId} projectId={projectId} />;
    case "tasks": return <TaskWorkspace key={projectId} projectId={projectId} />;
    case "scenes": return <Characters key={projectId} projectId={projectId} kind="scene" />;
    case "videos": return <VideoWorkspace key={projectId} projectId={projectId} />;
    case "creation": return <CreationWorkspace key={projectId} projectId={projectId} />;
    case "music": return <MusicWorkspace key={projectId} projectId={projectId} />;
    case "characters": return <Characters key={projectId} projectId={projectId} />;
    default: return <ImageWorkspace key={projectId} projectId={projectId} />;
  }
}

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Project>();
  const [workspace, setWorkspace] = useState<WorkspaceTab>("images");
  const [opened, setOpened] = useState<WorkspaceTab[]>(["images"]);
  const [leaving, setLeaving] = useState(false);
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

  useEffect(() => {
    fetch(`${baseUrl}/v1/projects`).then(async (response) => {
      if (!response.ok) throw new Error();
      setProjects((await response.json()).items);
    }).catch(() => setError("作品加载失败，请刷新重试。"));
  }, [baseUrl]);

  useEffect(() => {
    fetch(`${baseUrl}/health`)
      .then(async (response) => {
        if (!response.ok) throw new Error("health check failed");
        return response.json() as Promise<HealthResponse>;
      })
      .then(() => setApiStatus("online"))
      .catch(() => setApiStatus("offline"));
  }, [baseUrl]);

  // 先播放离场过渡，再替换视图；进入动画由 .view 的挂载动画负责。
  function navigateTo(next?: Project) {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => {
      setSelected(next);
      if (next) { setWorkspace("images"); setOpened(["images"]); }
      setLeaving(false);
    }, 220);
  }

  function openWorkspace(tab: WorkspaceTab) {
    setWorkspace(tab);
    setOpened(previous => previous.includes(tab) ? previous : [...previous, tab]);
    refreshStudio();
  }

  return <main className={`shell${selected ? " studio-shell" : ""}${leaving ? " is-leaving" : ""}`}>
    {selected ? (
      <div className="view" key={`studio:${selected.id}`}>
        <header className="topbar">
          <div>
            <span className="eyebrow">PROJECT WORKSPACE</span>
            <h1>{selected.name}</h1>
          </div>
          <button onClick={() => {
            if (window.confirm("返回会关闭当前编辑区，请先保存需要的结果。是否继续？")) navigateTo(undefined);
          }}>← 作品列表</button>
        </header>

        <nav className="workspace-tabs" aria-label="作品工作区">
          {TAB_ORDER.map(tab => <button key={tab} aria-pressed={workspace === tab} onClick={() => openWorkspace(tab)}>{TAB_LABELS[tab]}</button>)}
        </nav>

        {/* 已打开的工作区保持挂载以保留状态，仅切换显示；激活时播放进入动画。 */}
        {opened.map(tab => <div
          key={tab}
          className={`workspace-layer${workspace === tab ? " is-active" : ""}`}
          aria-hidden={workspace !== tab}
        ><WorkspaceView tab={tab} projectId={selected.id} /></div>)}
      </div>
    ) : (
      <div className="view" key="projects">
        <header className="topbar">
          <div>
            <span className="eyebrow">GAL RESOURCES TOOL</span>
            <h1>视觉小说素材工作室</h1>
          </div>
          <span className={`status status--${apiStatus}`}>API {apiStatus}</span>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">从作品设定到可用素材包</p>
            <h2>统一制作、确认与管理你的视觉小说素材。</h2>
            <p>创建或选择作品，进入角色档案与图片工作台，管理参考图、生成候选并导出素材。</p>
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
              <label htmlFor="name">作品名称</label>
              <input id="name" required maxLength={120} value={name} placeholder="例如：夏日与你的最后一封信" onChange={(event) => setName(event.target.value)} />
              <button disabled={saving || !name.trim()}>{saving ? "创建中…" : "创建作品"}</button>
            </form>
            {error && <p role="alert">{error}</p>}
          </div>
          <figure className="hero-art">
            <img src={shinoPortrait} alt="创作助手 星乃" />
            <figcaption>星乃 · 创作助手<small>YOUR STUDIO COMPANION</small></figcaption>
          </figure>
        </section>

        <section id="projects" aria-label="我的作品">
          <h2>我的作品</h2>
          {!projects.length && <p>填写上方作品名称并创建作品，即可开始使用图片工作台。</p>}
          <div className="grid">
            {projects.map((project) => <button className="card character-card" key={project.id} onClick={() => navigateTo(project)}>
              <h3>{project.name}</h3><span>打开图片工作台 →</span>
            </button>)}
          </div>
        </section>

        <section aria-label="制作流程">
          <h2>从设定走到成品</h2>
          <div className="grid">
            {[
              { title: "角色与图片", description: "角色档案、参考图、AI 生成与局部合成", status: "可使用" },
              { title: "场景与视频", description: "场景档案、背景生成与图生视频任务", status: "需配置生成服务" },
              { title: "角色设定历史", description: "在角色档案中查看历史设定并恢复旧版", status: "可使用" },
              { title: "图片素材导出", description: "在图片工作台中勾选图片，导出 ZIP 与来源清单", status: "可使用" },
            ].map(({ title, description, status }) => (
              <article className="card" key={title}>
                <h3>{title}</h3>
                <p>{description}</p>
                <span>{status}</span>
              </article>
            ))}
          </div>
        </section>
      </div>
    )}
  </main>;
}
