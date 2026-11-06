import { useEffect, useRef, useState, type PointerEvent } from "react";

type Point = { x: number; y: number };
type Selection = { start: Point; end: Point };

function position(event: PointerEvent<HTMLDivElement>): Point {
  const bounds = event.currentTarget.getBoundingClientRect();
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return {
    x: clamp((event.clientX - bounds.left) / bounds.width),
    y: clamp((event.clientY - bounds.top) / bounds.height),
  };
}

export function ExpressionMask({ source, filename, onSave, incoming }: {
  incoming?: File;
  source: string;
  filename: string;
  onSave: (image: { name: string; source: string; data_url: string }) => Promise<void>;
}) {
  const image = useRef<HTMLImageElement>(null);
  const drag = useRef<Point>(null);
  const [selection, setSelection] = useState<Selection>();
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState<File>();
  const [batch, setBatch] = useState<File[]>([]);
  const [feather, setFeather] = useState(0);
  const [result, setResult] = useState("");
  const [name, setName] = useState("表情差分");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!incoming) return;
    setCandidate(incoming);
    setBatch([incoming]);
    setName(incoming.name.replace(/\.[^.]+$/, ""));
    setResult("");
    setSaved(false);
  }, [incoming]);
  const rect = selection && {
    x: Math.min(selection.start.x, selection.end.x),
    y: Math.min(selection.start.y, selection.end.y),
    width: Math.abs(selection.start.x - selection.end.x),
    height: Math.abs(selection.start.y - selection.end.y),
  };
  const canExport = Boolean(rect && rect.width > 0 && rect.height > 0);

  async function composite() {
    const original = image.current;
    if (!original?.naturalWidth || !rect || !canExport || !candidate || busy) return;
    setBusy(true);
    setError("");
    setResult("");
    setSaved(false);
    try {
      if (candidate.size > 20 * 1024 * 1024) throw new Error("差分图不能超过 20MB。");
      const edited = await createImageBitmap(candidate);
      try {
        const width = original.naturalWidth;
        const height = original.naturalHeight;
        if (edited.width !== width || edited.height !== height) {
          throw new Error(`差分图必须与母版同尺寸（${width} × ${height}）。`);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建合成画布。");
        context.drawImage(original, 0, 0);
        const left = Math.floor(rect.x * width);
        const top = Math.floor(rect.y * height);
        const right = Math.min(width, Math.ceil((rect.x + rect.width) * width));
        const bottom = Math.min(height, Math.ceil((rect.y + rect.height) * height));
        const w = right - left;
        const h = bottom - top;
        if (feather === 0) {
          context.clearRect(left, top, w, h);
          context.drawImage(edited, left, top, w, h, left, top, w, h);
        } else {
          const base = context.getImageData(left, top, w, h);
          context.clearRect(left, top, w, h);
          context.drawImage(edited, left, top, w, h, left, top, w, h);
          const patch = context.getImageData(left, top, w, h);
          const radius = Math.min(feather, w / 2, h / 2);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const index = (y * w + x) * 4;
              const edge = Math.min(x + .5, y + .5, w - x - .5, h - y - .5);
              const weight = Math.min(1, edge / radius);
              const a = base.data[index + 3]! * (1 - weight);
              const b = patch.data[index + 3]! * weight;
              for (let channel = 0; channel < 3; channel++) {
                base.data[index + channel] = a + b
                  ? (base.data[index + channel]! * a + patch.data[index + channel]! * b) / (a + b)
                  : 0;
              }
              base.data[index + 3] = a + b;
            }
          }
          context.putImageData(base, left, top);
        }
        const png = canvas.toDataURL("image/png");
        if (!png.startsWith("data:image/png;base64,")) throw new Error("无法编码合成图片。");
        setResult(png);
      } finally {
        edited.close();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取差分图。");
    } finally {
      setBusy(false);
    }
  }

  function exportMask() {
    const original = image.current;
    if (!original?.naturalWidth || !rect || !canExport) return;
    setError("");
    const canvas = document.createElement("canvas");
    canvas.width = original.naturalWidth;
    canvas.height = original.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) { setError("无法创建蒙版，请尝试尺寸较小的图片。"); return; }
    context.fillStyle = "#000";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#fff";
    const left = Math.floor(rect.x * canvas.width);
    const top = Math.floor(rect.y * canvas.height);
    const right = Math.ceil((rect.x + rect.width) * canvas.width);
    const bottom = Math.ceil((rect.y + rect.height) * canvas.height);
    context.fillRect(left, top, right - left, bottom - top);
    if (feather > 0) {
      const width = right - left;
      const height = bottom - top;
      const pixels = context.getImageData(left, top, width, height);
      const radius = Math.min(feather, width / 2, height / 2);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const edge = Math.min(x + .5, y + .5, width - x - .5, height - y - .5);
          const value = Math.round(255 * Math.min(1, edge / radius));
          const index = (y * width + x) * 4;
          pixels.data[index] = value;
          pixels.data[index + 1] = value;
          pixels.data[index + 2] = value;
        }
      }
      context.putImageData(pixels, left, top);
    }
    canvas.toBlob(blob => {
      if (!blob) { setError("蒙版导出失败，请尝试尺寸较小的图片。"); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename.replace(/\.[^.]+$/, "") + "-mask.png";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }

  return <section>
    <h3>表情差分蒙版</h3>
    <p>在标准参考图上拖动框选脸部区域。白色表示可修改，黑色表示保留。</p>
    <div className="mask-editor"
      onPointerDown={event => {
        if (busy || !event.isPrimary || event.button !== 0 || !image.current?.naturalWidth) return;
        setResult("");
        event.currentTarget.setPointerCapture(event.pointerId);
        const start = position(event);
        drag.current = start;
        setSelection({ start, end: start });
      }}
      onPointerMove={event => {
        if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
          setSelection({ start: drag.current, end: position(event) });
        }
      }}
      onPointerUp={event => {
        if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        setSelection({ start: drag.current, end: position(event) });
        drag.current = null;
      }}
      onLostPointerCapture={() => { drag.current = null; }}>
      <img ref={image} src={source} alt="标准参考图，拖动圈选修改区域" draggable={false} />
      {rect && <div aria-hidden="true" className="mask-selection" style={{
        left: rect.x * 100 + "%", top: rect.y * 100 + "%",
        width: rect.width * 100 + "%", height: rect.height * 100 + "%",
      }} />}
    </div>
    <p><a href={source} download={filename}>下载原图</a>{" "}
      <button type="button" onClick={exportMask} disabled={!canExport}>下载 PNG 蒙版</button>{" "}
      <button type="button" onClick={() => { setSelection(undefined); setResult(""); }} disabled={busy || !selection}>清空选区</button>
    </p>
    <h3>导入差分并合成</h3>
    {candidate && <p role="status">当前差分图：{candidate.name}。圈选允许修改的区域后点击“预览合成”。</p>}
    <label>选择与原图同尺寸的差分图，可多选{" "}
      <input type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event => {
        const files = Array.from(event.target.files ?? []);
        setBatch(files);
        setCandidate(files[0]);
        setName(files[0]?.name.replace(/\.[^.]+$/, "").slice(0, 240) || "表情差分");
        setResult("");
      }} />
    </label>{" "}
    {batch.length > 1 && <label>当前候选{" "}
      <select disabled={busy} value={candidate ? batch.indexOf(candidate) : 0} onChange={event => {
        const file = batch[Number(event.target.value)];
        setCandidate(file);
        setName(file?.name.replace(/\.[^.]+$/, "").slice(0, 240) || "表情差分");
        setResult("");
      }}>{batch.map((file, index) => <option key={index} value={index}>{file.name}</option>)}</select>
    </label>}
    <p><label>边缘羽化（原图像素）{" "}
      <input type="range" min={0} max={64} value={feather} disabled={busy} onChange={event => {
        setFeather(Number(event.target.value));
        setResult("");
      }} /> {feather}px
    </label></p>
    <button type="button" disabled={busy || !candidate || !canExport} onClick={() => { void composite(); }}>预览合成</button>
    {result && <>
      <div className="grid">
        <figure><img className="composite-preview" src={source} alt="合成前的标准参考图" /><figcaption>原图</figcaption></figure>
        <figure><img className="composite-preview" src={result} alt="合成后的表情差分" /><figcaption>合成结果</figcaption></figure>
      </div>
      <label>差分名称 <input value={name} maxLength={240} disabled={busy} onChange={event => setName(event.target.value)} /></label>{" "}
      <a href={result} download={(name.trim() || "表情差分") + ".png"}>下载合成 PNG</a>{" "}
      <button type="button" disabled={busy || saved || !name.trim()} onClick={async () => {
        setBusy(true);
        setError("");
        try {
          if ((result.length - "data:image/png;base64,".length) * 3 / 4 - (result.endsWith("==") ? 2 : result.endsWith("=") ? 1 : 0) > 5 * 1024 * 1024) {
            throw new Error("合成图超过入库上限 5MB，请使用下载保存。");
          }
          await onSave({ name: name.trim() + ".png", source: `由标准参考图 ${filename} 与导入差分 ${candidate?.name ?? ""} 局部合成`, data_url: result });
          setSaved(true);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "保存失败。");
        } finally { setBusy(false); }
      }}>{saved ? "已保存到角色参考图" : "保存到角色参考图"}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
