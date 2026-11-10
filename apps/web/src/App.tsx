import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { refreshStudio } from "./refresh";
import { ConversationWorkspace } from "./ConversationWorkspace";
import { UiWorkspace } from "./UiWorkspace";
import { StudioWorkspace } from "./StudioWorkspace";
import { TaskWorkspace } from "./TaskWorkspace";
import { VideoWorkspace } from "./VideoWorkspace";
import { CreationWorkspace } from "./CreationWorkspace";
import { Characters } from "./Characters";
import { ImageWorkspace } from "./ImageWorkspace";
import { MusicWorkspace } from "./MusicWorkspace";
import { AudioGeneration } from "./AudioGeneration";
import shinoPortrait from "./assets/shino-pink.png";

type ApiStatus = "checking" | "online" | "offline";
type Project = { id: string; name: string };

const departments = [
  { id: "characters", title: "人设", english: "CHARACTERS", number: "01", description: "角色档案 · 立绘差分 · 剧情排练",
    pages: [{ id: "profiles", title: "角色档案" }, { id: "sprites", title: "立绘与差分" }, { id: "dialogue", title: "角色访谈" }, { id: "sprite-plan", title: "立绘方案" }] },
  { id: "images", title: "图片", english: "ILLUSTRATION", number: "02", description: "插画生成 · 场景背景 · 界面素材",
    pages: [{ id: "illustrations", title: "插画工作台" }, { id: "scenes", title: "场景与背景" }, { id: "ui", title: "UI 素材" }, { id: "image-plan", title: "图片方案" }] },
  { id: "videos", title: "视频", english: "MOTION", number: "03", description: "镜头方案 · 视频生成 · 裁剪与循环",
    pages: [{ id: "motion", title: "视频生成与剪辑" }, { id: "motion-plan", title: "镜头方案" }] },
  { id: "music", title: "音乐", english: "SOUND", number: "04", description: "背景音乐 · 环境声 · 音效编辑",
    pages: [{ id: "tracks", title: "音乐库与剪辑" }, { id: "audio", title: "AI 配乐与音效" }] },
] as const;
const utilities = [
  { id: "resources", title: "作品资源", english: "ASSETS" },
  { id: "queue", title: "任务队列", english: "QUEUE" },
] as const;
type Department = typeof departments[number];
type IconName = Department["id"] | typeof utilities[number]["id"] | "overview" | "brand";
type Page = Department["pages"][number]["id"] | typeof utilities[number]["id"] | "overview";

const paths: Record<IconName, readonly [silhouette: string, detail: string]> = {
  brand: ["M12 4c2-4 6-.7 4.3 3.5 4.4-1.6 7.1 2.7 3.4 5.3l-2.1.6c3 3.4.2 7.9-3.6 5.7l-2-1.8-2 1.8c-3.8 2.2-6.6-2.3-3.6-5.7l-2.1-.6c-3.7-2.6-1-6.9 3.4-5.3C6 3.3 10 0 12 4Z", "m12 8 .9 2.9 2.9.9-2.9.9-.9 2.9-.9-2.9-2.9-.9 2.9-.9Z"],
  overview: ["M3 6c3-1.2 6-.8 9 1.5C15 5.2 18 4.8 21 6v13c-3-1.2-6-.8-9 1.5C9 18.2 6 17.8 3 19Z", "M12 7.5v13M6 10c1.3-.1 2.5.2 3.5.7M6 13.5c1.3-.1 2.5.2 3.5.7m5-3.5c1-.5 2.2-.8 3.5-.7"],
  characters: ["M4 8.5c0-3.8 4.6-5.2 8-1.2 3.4-4 8-2.6 8 1.2 0 4.3-8 8.9-8 8.9s-8-4.6-8-8.9Z", "M12 17.4v3.3m-3.5.2L12 18l3.5 2.9M8 9.5h.01m8 0h.01m-5.6 2.5c.9 1 2.3 1 3.2 0"],
  images: ["M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z", "m3 17 5-5 4 4 2.6-2.6L21 19M16.5 7.6l.7 2.1 2.1.7-2.1.7-.7 2.1-.7-2.1-2.1-.7 2.1-.7Z"],
  videos: ["M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm0 0L2 5l17-3 1 4Z", "m6 4.3 3 3.3m3-4.4 3 3.4M10 12l5 3-5 3Z"],
  music: ["M9 18V7l11-3v11M9 18c0 1.2-1.4 2.3-3.2 2.3S3 19.6 3 18.4s1.4-2.3 3.2-2.3S9 16.8 9 18Zm11-3c0 1.2-1.4 2.3-3.2 2.3s-2.8-.7-2.8-1.9 1.4-2.3 3.2-2.3 2.8.7 2.8 1.9Z", "m9 10 11-3M4 5v5M1.5 7.5h5"],
  resources: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10H3Z", "M3 10h18m-9 2 .7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z"],
  queue: ["M7 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M8 3h8v4H8Z", "m6 12 1.4 1.4L10 11m2 2h5m-5 4h5m-10 0h.01"],
};

function Icon({ name }: { name: IconName }) {
  const [silhouette, detail] = paths[name];
  return <svg className="studio-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={silhouette} fill="currentColor" fillOpacity=".15" />
    <path d={detail} />
  </svg>;
}

function projectHref(id: string, page: Page = "overview") {
  return `#/project/${encodeURIComponent(id)}/${page}`;
}

function readRoute(): { projectId?: string; page: Page } {
  const [, section, encodedId, segment] = window.location.hash.split("/");
  if (section !== "project" || !encodedId) return { projectId: undefined, page: "overview" };
  const departmentPage = departments.flatMap(department => [...department.pages]).find(page => page.id === segment);
  const utility = utilities.find(item => item.id === segment);
  try { return { projectId: decodeURIComponent(encodedId), page: departmentPage?.id ?? utility?.id ?? "overview" }; }
  catch { return { projectId: undefined, page: "overview" }; }
}

function DepartmentCards({ projectId }: { projectId?: string }) {
  return <div className="department-grid">
    {departments.map(department => {
      const content = <>
        <span className="department-index"><span className="department-sticker"><Icon name={department.id} /></span><span>CH. {department.number}</span></span>
        <span className="department-title">{department.title}<small>{department.english}</small></span>
        <span className="department-description">{department.description}</span>
      </>;
      return projectId
        ? <a className="department-card" data-department={department.id} key={department.id} href={projectHref(projectId, department.pages[0].id)}>{content}<span className="card-arrow" aria-hidden="true">↗</span></a>
        : <div className="department-card" data-department={department.id} key={department.id}>{content}</div>;
    })}
  </div>;
}

function WorkspaceView({ page, projectId, videoPrompt, setVideoPrompt }: {
  page: Page; projectId: string; videoPrompt: string; setVideoPrompt: (prompt: string) => void;
}) {
  switch (page) {
    case "profiles": return <Characters projectId={projectId} />;
    case "sprites": return <ImageWorkspace projectId={projectId} onAddCharacter={projectHref(projectId, "profiles")} />;
    case "dialogue": return <ConversationWorkspace projectId={projectId} />;
    case "sprite-plan": return <CreationWorkspace projectId={projectId} kinds={["角色"]} />;
    case "illustrations": return <ImageWorkspace projectId={projectId} kind="image" />;
    case "scenes": return <Characters projectId={projectId} kind="scene" />;
    case "ui": return <UiWorkspace projectId={projectId} />;
    case "image-plan": return <CreationWorkspace projectId={projectId} kinds={["图片", "场景"]} />;
    case "motion": return <VideoWorkspace projectId={projectId} prompt={videoPrompt} onPromptChange={setVideoPrompt} />;
    case "motion-plan": return <CreationWorkspace projectId={projectId} kinds={["视频"]} onUsePrompt={prompt => {
      setVideoPrompt(prompt);
      window.location.hash = projectHref(projectId, "motion");
    }} />;
    case "tracks": return <MusicWorkspace projectId={projectId} />;
    case "audio": return <AudioGeneration projectId={projectId} onApproved={async () => refreshStudio()} />;
    case "resources": return <StudioWorkspace projectId={projectId} />;
    case "queue": return <TaskWorkspace projectId={projectId} />;
    case "overview": return <>
      <DepartmentCards projectId={projectId} />
      <div className="project-shortcuts">
        <a href={projectHref(projectId, "resources")}><Icon name="resources" />整理风格、需求与成品 <span aria-hidden="true">→</span></a>
        <a href={projectHref(projectId, "queue")}><Icon name="queue" />跟进生成任务与候选 <span aria-hidden="true">→</span></a>
      </div>
    </>;
  }
}

function ProjectStudio({ project, page }: { project: Project; page: Page }) {
  const [opened, setOpened] = useState<Page[]>([page]);
  const [videoPrompt, setVideoPrompt] = useState("");
  const department = departments.find(item => item.pages.some(tool => tool.id === page));
  const tool = department?.pages.find(item => item.id === page);
  const utility = utilities.find(item => item.id === page);
  const title = department?.title ?? utility?.title ?? "作品总览";

  useEffect(() => {
    setOpened(previous => previous.includes(page) ? previous : [...previous, page]);
    refreshStudio();
  }, [page]);

  return <div className="studio-frame">
    <aside className="studio-rail">
      <div className="rail-project"><span className="eyebrow">CURRENT PROJECT</span><strong>{project.name}</strong></div>
      <nav aria-label="作品导航">
        <a className="rail-link" href={projectHref(project.id)} aria-current={page === "overview" ? "page" : undefined}><Icon name="overview" /><span>作品总览<small>OVERVIEW</small></span></a>
        <p className="rail-label">创作模块</p>
        {departments.map(item => <a className="rail-link" data-department={item.id} key={item.id} href={projectHref(project.id, item.pages[0].id)}
          aria-current={department?.id === item.id ? "true" : undefined}><Icon name={item.id} /><span>{item.title}<small>{item.english}</small></span><small className="rail-index">{item.number}</small></a>)}
        <p className="rail-label">项目管理</p>
        {utilities.map(item => <a className="rail-link" key={item.id} href={projectHref(project.id, item.id)}
          aria-current={item.id === page ? "page" : undefined}><Icon name={item.id} /><span>{item.title}<small>{item.english}</small></span></a>)}
      </nav>
    </aside>

    <main className="studio-main" data-department={department?.id}>
      <header className="studio-section-heading">
        <div>
          <p className="studio-breadcrumb"><a href={projectHref(project.id)}>{project.name}</a><span aria-hidden="true">/</span>{title}</p>
          <p className="eyebrow">{department?.number && `${department.number} / `}{department?.english ?? utility?.english ?? "PROJECT OVERVIEW"}</p>
          <h1>{title}</h1>
          <p className="section-description">{department?.description ?? (utility ? utility.id === "queue" ? "查看生成进度、历史任务与回收站。" : "管理制作需求、已确认素材与导出记录。" : "为这部作品挑选一个创作模块。")}</p>
        </div>
        <Icon name={department?.id ?? utility?.id ?? "overview"} />
      </header>
      {department && <nav className="tool-nav" aria-label={`${department.title}工具`}>
        {department.pages.map(item => <a key={item.id} href={projectHref(project.id, item.id)} aria-current={tool?.id === item.id ? "page" : undefined}>{item.title}</a>)}
      </nav>}
      {[...new Set([...opened, page])].map(item => <div key={item} className="workspace-page" hidden={page !== item}>
        <WorkspaceView page={item} projectId={project.id} videoPrompt={videoPrompt} setVideoPrompt={setVideoPrompt} />
      </div>)}
    </main>
  </div>;
}

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>("checking");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [route, setRoute] = useState(readRoute);
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  const selected = projects.find(project => project.id === route.projectId);

  useEffect(() => {
    function onNavigate() {
      setRoute(readRoute());
      window.scrollTo(0, 0);
    }
    window.addEventListener("hashchange", onNavigate);
    return () => window.removeEventListener("hashchange", onNavigate);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${baseUrl}/v1/projects`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      setProjects((await response.json()).items);
    }).catch(() => { if (!controller.signal.aborted) setError("作品加载失败，请刷新重试。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    fetch(`${baseUrl}/health`, { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); setApiStatus("online"); })
      .catch(() => { if (!controller.signal.aborted) setApiStatus("offline"); });
    return () => controller.abort();
  }, [baseUrl]);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${baseUrl}/v1/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim() }) });
      if (!response.ok) throw new Error();
      const project = await response.json() as Project;
      setProjects(items => [project, ...items]);
      setName("");
      window.location.hash = projectHref(project.id);
    } catch { setError("创建失败，请稍后重试。"); }
    finally { setSaving(false); }
  }

  function confirmLeaving(event: React.MouseEvent<HTMLAnchorElement>) {
    if (selected && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && !window.confirm("返回作品列表会关闭当前编辑区，请先保存需要的结果。是否继续？")) event.preventDefault();
  }

  return <>
    <header className="app-header">
      <a className="studio-brand" href="#/" onClick={confirmLeaving}><span className="brand-symbol"><Icon name="brand" /></span><span>视觉小说素材工作室<small>GAL RESOURCES STUDIO</small></span></a>
      <div className="app-actions">
        {selected && <a className="header-back" href="#/" onClick={confirmLeaving}>← 作品列表</a>}
        {selected && <a className="header-queue" href={projectHref(selected.id, "queue")}><Icon name="queue" />任务队列</a>}
        <span className={`connection-state connection-state--${apiStatus}`} role="status">{apiStatus === "online" ? "本地服务在线" : apiStatus === "offline" ? "本地服务离线" : "连接中"}</span>
      </div>
    </header>

    {route.projectId ? (
      selected ? <ProjectStudio key={selected.id} project={selected} page={route.page} /> :
        <main className="studio-home"><section className="workspace-empty">
          <h1>{loading ? "正在打开作品…" : error || "找不到该作品"}</h1>
          <a href="#/">返回作品列表 →</a>
        </section></main>
    ) : <main className="studio-home">
      <section className="studio-hero">
        <figure className="studio-hero-art">
          <span className="hero-orbit" aria-hidden="true" />
          <span className="hero-stars" aria-hidden="true"><span>✦</span><span>✧</span><span>✦</span><span>✧</span></span>
          <img src={shinoPortrait} alt="粉发金瞳、穿粉白水手服的创作助手星乃" />
          <span className="hero-dialogue">今天想写哪段故事？</span>
          <figcaption><strong>星乃</strong><span>SHINO · 创作助手</span></figcaption>
        </figure>
        <div className="studio-hero-copy">
          <p className="eyebrow hero-kicker"><span aria-hidden="true">✿</span> VISUAL NOVEL STUDIO</p>
          <h1>让故事有形，<br /><em>也有声音。</em></h1>
          <p>为视觉小说制作角色立绘、场景背景、动态镜头和配乐。在同一个作品中整理设定、确认候选与导出素材。</p>
          <form className="new-project" onSubmit={createProject}>
            <label className="visually-hidden" htmlFor="name">作品名称</label>
            <input id="name" required maxLength={120} value={name} placeholder="输入新作品名称" onChange={event => setName(event.target.value)} />
            <button className="primary-action" disabled={saving || !name.trim()}>{saving ? "创建中…" : "＋ 新建作品"}</button>
          </form>
          {error && <p role="alert">{error}</p>}
        </div>
      </section>

      <section aria-label="创作模块" className="home-section">
        <div className="home-section-heading"><h2>创作模块</h2><span className="eyebrow">{projects[0] ? `最近作品 · ${projects[0].name}` : "01 — 04 / DEPARTMENTS"}</span></div>
        <DepartmentCards projectId={projects[0]?.id} />
      </section>

      <section aria-label="我的作品" className="home-section">
        <div className="home-section-heading"><h2>我的作品</h2><span className="eyebrow">PROJECT ARCHIVE / {String(projects.length).padStart(2, "0")}</span></div>
        {loading ? <p role="status">正在读取作品…</p> : !projects.length && !error && <p className="archive-empty">创建第一个作品，开始管理设定与素材。</p>}
        <div className="grid">{projects.map((project, index) => <a className="card project-card" key={project.id} href={projectHref(project.id)}>
          <span className="eyebrow">PROJECT / {String(index + 1).padStart(2, "0")}</span><h3>{project.name}</h3><span>打开作品 →</span>
        </a>)}</div>
      </section>
    </main>}
  </>;
}
