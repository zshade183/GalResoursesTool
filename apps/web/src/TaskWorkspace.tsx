import { useEffect, useState } from "react";
import { JobRecordAction } from "./JobRecordAction";
import { useRefreshRevision } from "./refresh";

const mediaTypes = [
  { path: "image-jobs", label: "图片" },
  { path: "videos", label: "视频" },
  { path: "audio-jobs", label: "音频" },
] as const;
type Job = { id: string; state: string; error?: string; created_at: string; deleted_at?: string; input?: { name?: string; prompt?: string } };
type ListedJob = Job & { media: (typeof mediaTypes)[number] };

const labels: Record<string, string> = {
  queued: "排队中", running: "生成中", submitting: "提交中", processing: "处理中",
  awaiting_review: "等待确认", approved: "已确认", cancelled: "已取消", failed: "失败",
  reconcile_required: "需核对服务记录", download_failed: "文件下载失败",
};
const activeStates = new Set(["queued", "submitting", "running", "processing"]);

export function TaskWorkspace({ projectId }: { projectId: string }) {
  const base = `${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}`;
  const revision = useRefreshRevision();
  const [jobs, setJobs] = useState<ListedJob[]>([]);
  const [trash, setTrash] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mediaFilter, setMediaFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const lists = await Promise.all(mediaTypes.map(async media => {
          const response = await fetch(`${base}/${media.path}${trash ? "?trash=1" : ""}`, { signal: controller.signal });
          if (!response.ok) throw new Error("任务读取失败。");
          const { items } = await response.json() as { items: Job[] };
          return items.map(job => ({ ...job, media }));
        }));
        if (!controller.signal.aborted) {
          setJobs(lists.flat().sort((a, b) => (b.deleted_at ?? b.created_at).localeCompare(a.deleted_at ?? a.created_at)));
          setError("");
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(String(cause));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => void poll(), 5000);
        }
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base, trash, revision, reload]);

  function showTrash(next: boolean) {
    if (next === trash) return;
    setLoading(true);
    setJobs([]);
    setError("");
    setStatusFilter("all");
    setTrash(next);
  }

  const active = jobs.filter(job => activeStates.has(job.state)).length;
  const awaiting = jobs.filter(job => job.state === "awaiting_review").length;
  const matches = jobs.filter(job => (mediaFilter === "all" || job.media.path === mediaFilter)
    && (statusFilter === "all" || (statusFilter === "active" ? activeStates.has(job.state) : job.state === statusFilter))
    && [job.id, job.input?.name, job.input?.prompt].some(value => value?.toLowerCase().includes(query.trim().toLowerCase())));

  return <section className="workbench-panel queue-workbench">
    {!trash && <div className="queue-summary" aria-label="任务统计">
      <div><span>任务总数</span><strong>{jobs.length}</strong></div>
      <div><span>排队 / 处理中</span><strong>{active}</strong></div>
      <div><span>等待确认</span><strong>{awaiting}</strong></div>
    </div>}
    <nav className="workspace-tabs" aria-label="任务记录">
      <button aria-pressed={!trash} onClick={() => showTrash(false)}>任务记录</button>
      <button aria-pressed={trash} onClick={() => showTrash(true)}>回收站</button>
    </nav>
    <div className="queue-filters">
      <label>媒介<select value={mediaFilter} onChange={event => setMediaFilter(event.target.value)}>
        <option value="all">全部媒介</option>{mediaTypes.map(media => <option value={media.path} key={media.path}>{media.label}</option>)}
      </select></label>
      {!trash && <label>状态<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
        <option value="all">全部状态</option><option value="active">排队 / 处理中</option>
        {Object.entries(labels).filter(([state]) => !activeStates.has(state)).map(([state, label]) => <option key={state} value={state}>{label}</option>)}
      </select></label>}
      <label className="queue-search">搜索任务<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="名称、提示词或任务 ID" /></label>
      <button onClick={() => { setLoading(true); setReload(value => value + 1); }}>刷新</button>
    </div>
    <p>删除会将本地记录移入回收站，已入库素材和服务账单保留。状态未知的任务可恢复后继续核对。</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">正在加载任务…</p>}
    <div className="grid">{matches.map(job => <article className="card" key={`${job.media.path}/${job.id}`}>
      <h3>{job.media.label} · {labels[job.state] ?? job.state}</h3>
      {job.input?.name && <p><strong>{job.input.name}</strong></p>}
      <p>{job.input?.prompt}</p><small>{job.id}</small>
      {job.error && <p role="alert">{job.error}</p>}
      <p>{new Date(job.deleted_at ?? job.created_at).toLocaleString("zh-CN")}</p>
      <JobRecordAction url={`${base}/${job.media.path}/${job.id}`} state={job.state} restore={trash}
        onChanged={() => setJobs(previous => previous.filter(item => item.id !== job.id || item.media.path !== job.media.path))} />
    </article>)}</div>
    {!loading && !error && !matches.length && <div className="workspace-empty"><p>{jobs.length ? "没有符合筛选条件的任务。" : trash ? "回收站为空。" : "尚无任务。提交生成后，可在这里查看进度。"}</p></div>}
  </section>;
}
