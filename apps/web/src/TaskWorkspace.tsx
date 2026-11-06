import { useEffect, useState } from "react";
type Job = { id: string; state: string; error?: string; created_at: string; input: { prompt: string }; media: string; output_count?: number };
export function TaskWorkspace({ projectId }: { projectId: string }) {
  const [jobs, setJobs] = useState<Job[]>([]), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const lists = await Promise.all(["image-jobs", "videos", "audio-jobs"].map(async (path, index) => { const r = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}/${path}`, { signal: controller.signal }); if (!r.ok) throw new Error("任务读取失败"); return (await r.json()).items.map((job: Job) => ({ ...job, media: ["图片", "视频", "音频"][index] })); })); if (!controller.signal.aborted) { setJobs(lists.flat().sort((a, b) => b.created_at.localeCompare(a.created_at))); setError(""); } } catch(e) { if (!controller.signal.aborted) setError(String(e)); } finally { if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5000); } }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId]);
  const labels: Record<string, string> = { queued: "排队中", running: "生成中", submitting: "提交中", processing: "处理中", awaiting_review: "等待确认", approved: "已确认", cancelled: "已取消", failed: "失败", reconcile_required: "需核对服务记录", download_failed: "文件下载失败" };
  return <section><h2>任务中心</h2><p>任务在后端持续执行，离开制作页面不会中断。未知提交状态需核对服务记录，避免重复计费。</p>{error && <p role="alert">{error}</p>}<div className="grid">{jobs.map(job => <article className="card" key={job.id}><h3>{job.media} · {labels[job.state] ?? job.state}</h3><p>{job.input.prompt}</p><small>{job.id}</small>{job.error && <p role="alert">{job.error}</p>}<p>{new Date(job.created_at).toLocaleString("zh-CN")}</p></article>)}</div>{!jobs.length && <p>尚无任务</p>}</section>;
}
