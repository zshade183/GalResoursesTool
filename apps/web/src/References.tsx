import { useEffect, useState } from "react";
type Image = { id: string; name: string; data_url: string; source: string };
export function References({ projectId, characterId }: { projectId: string; characterId: string }) {
  const [images, setImages] = useState<Image[]>([]);
  const [standard, setStandard] = useState<string>();
  const [file, setFile] = useState<File>();
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = `${import.meta.env.VITE_API_BASE_URL ?? ""}/v1/projects/${projectId}/characters/${characterId}/references`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error("图片加载失败"); const data = await r.json(); setImages(data.items); setStandard(data.standard_id); }).catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    return () => controller.abort();
  }, [url]);
  return <section><h3>角色参考图</h3><p>导入后可选择一张标准参考图。支持 PNG、JPEG、WebP，每张不超过 5MB。</p>
    <form className="character-form" onSubmit={async event => {
      event.preventDefault(); if (!file || busy) return;
      if (file.size > 5 * 1024 * 1024) { setError("图片不能超过 5MB"); return; }
      setBusy(true); setError("");
      try {
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file); });
        // Decode before upload so truncated or excessively large images are rejected.
        const image = await createImageBitmap(file);
        const pixels = image.width * image.height; image.close();
        if (pixels > 40000000) throw new Error("图片分辨率过大，请缩小后导入");
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: file.name, source, data_url: data }) });
        if (!response.ok) throw new Error((await response.json()).message ?? "导入失败");
        const saved = await response.json(); setImages(previous => [saved, ...previous]);
      } catch (e) { setError(String(e)); } finally { setBusy(false); }
    }}><label>选择图片<input type="file" accept="image/png,image/jpeg,image/webp" required disabled={busy} onChange={event => setFile(event.target.files?.[0])} /></label>
      <label>来源与使用说明<input required maxLength={2000} placeholder="例如：本人绘制，或作者与授权说明" value={source} onChange={e => setSource(e.target.value)} disabled={busy} /></label><button disabled={busy || !file || !source.trim()}>{busy ? "处理中…" : "导入参考图"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <div className="grid">{images.map(image => <article className="card" key={image.id}><img src={image.data_url} alt={image.name} style={{ width: "100%", height: 220, objectFit: "contain" }} /><h4>{image.name}</h4><p>{image.source}</p><button disabled={busy || standard === image.id} onClick={async () => {
      setBusy(true); setError("");
      try { const response = await fetch(`${url}/standard`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_id: image.id }) }); if (!response.ok) throw new Error("设置失败"); setStandard(image.id); } catch(e) { setError(String(e)); } finally { setBusy(false); }
    }}>{standard === image.id ? "当前标准参考" : "设为标准参考"}</button></article>)}</div>
  </section>;
}
