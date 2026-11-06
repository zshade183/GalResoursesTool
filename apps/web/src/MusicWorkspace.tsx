import { useRefreshRevision } from "./refresh";
import { AudioEditor } from "./AudioEditor";
import { AudioGeneration } from "./AudioGeneration";
import { useEffect, useState } from "react";
type Track = { id: string; name: string; purpose: string; source: string; mime: string; bytes: number };
const purposes: Record<string, string> = { bgm: "背景音乐", ambience: "环境氛围", sfx: "音效" };
export function MusicWorkspace({ projectId }: { projectId: string }) {
  const refreshRevision = useRefreshRevision();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [name, setName] = useState("");
  const [source, setSource] = useState("");
  const [purpose, setPurpose] = useState("bgm");
  const [file, setFile] = useState<File>();
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const url = `${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}/music`;
  async function load() {
    setLoading(true);
    try { const response = await fetch(url); if (!response.ok) throw new Error("音乐库加载失败"); setTracks((await response.json()).items); }
    catch (cause) { setError(String(cause)); } finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [url, refreshRevision]);
  return <section><header className="workspace-header"><div><p className="eyebrow">SOUND LIBRARY</p><h2>给故事一点声音</h2><p>为场景挑选配乐，整理环境声与音效。</p></div><span className="status">本地音乐库</span></header>
    <AudioGeneration projectId={projectId} onApproved={load} />
    <div className="generation-layout"><aside className="generation-controls"><h3>导入音频</h3>
      <form className="character-form" onSubmit={async event => {
        event.preventDefault(); if (!file || busy) return;
        setBusy(true); setError("");
        try {
          if (file.size > 20 * 1024 * 1024) throw new Error("单个音频不超过 20MB");
          const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => resolve(String(reader.result).split(",")[1]!); reader.readAsDataURL(file); });
          const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, source, purpose, data }) });
          if (!response.ok) throw new Error((await response.json()).message);
          await load();
          setFile(undefined); setName("");
        } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
      }}>
        <label>音频文件<input type="file" accept=".wav,.mp3,.ogg" disabled={busy} onChange={event => { const selected = event.target.files?.[0]; setFile(selected); setName(selected?.name.slice(0, 200) ?? ""); }} /></label>
        <label>名称<input required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
        <label>用途<select value={purpose} onChange={event => setPurpose(event.target.value)}>{Object.entries(purposes).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        <label>来源与许可说明<textarea required maxLength={2000} value={source} onChange={event => setSource(event.target.value)} placeholder="作者、来源链接、使用许可或本人创作" /></label>
        <p>支持 WAV、MP3、OGG，每份不超过 20MB。</p><button disabled={busy || !file}>{busy ? "导入中…" : "保存到音乐库"}</button>
      </form>
    </aside><div className="generation-results">
      <nav className="workspace-tabs" aria-label="音频筛选">{Object.entries({ all: "全部", ...purposes }).map(([key, value]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{value}</button>)}</nav>
      {error && <div role="alert">{error}<button onClick={() => { setError(""); void load(); }}>重新加载</button></div>}
      {loading && <p role="status">正在加载音乐库…</p>}
      {!loading && !tracks.length && <p>这里还很安静。导入第一首音乐，为故事定下基调。</p>}
      {tracks.filter(track => filter === "all" || track.purpose === filter).map(track => <article className="card" key={track.id}><h3>{track.name}</h3><span>{purposes[track.purpose]} · {(track.bytes / 1024 / 1024).toFixed(1)}MB</span>
        <audio controls preload="none" src={`${url}/${track.id}/file`} style={{ width: "100%", marginTop: 16 }} onPlay={event => { document.querySelectorAll("audio").forEach(audio => { if (audio !== event.currentTarget) audio.pause(); }); }} />
        <p>{track.source}</p><a href={`${url}/${track.id}/file`} download={`${track.name.replace(/\.(mp3|wav|ogg)$/i, "")}.${track.mime === "audio/wav" ? "wav" : track.mime === "audio/ogg" ? "ogg" : "mp3"}`}>下载原始音频</a>
        <AudioEditor url={url} name={track.name} parentId={track.id} purpose={track.purpose} onSaved={load} />
      </article>)}
    </div></div>
  </section>;
}
