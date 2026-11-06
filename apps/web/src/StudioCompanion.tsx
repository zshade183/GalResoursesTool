import { useState } from "react";
import shinoPortrait from "./assets/shino-anime.png";

const lines = [
  "今天，要让谁的故事开始呢？",
  "先选定一张母版，我们再一起寻找她的表情。",
  "开心、犹豫、强装镇定……细微的表情也能讲故事。",
  "满意的候选记得确认入库，故事里的相遇值得留下。",
];

export function StudioCompanion() {
  const [line, setLine] = useState(0);
  const [paused, setPaused] = useState(false);
  return <section className={`studio-companion${paused ? " is-paused" : ""}`} aria-label="创作助手 星乃">
    <div className="companion-art companion-anime">
      <img className="companion-portrait" src={shinoPortrait} alt="星乃，银紫色长发、星形发饰，穿学院制服，手捧故事书的日漫风创作助手" />
      <span className="companion-orbit" aria-hidden="true">✧</span>
    </div>
    <div className="companion-dialogue">
      <span className="companion-name">星乃 <small>创作助手</small></span>
      <p aria-live="polite">{lines[line]}</p>
      <div className="companion-actions">
        <button onClick={() => setLine(previous => (previous + 1) % lines.length)} aria-label="下一句提示">继续对话 ▸</button>
        <button onClick={() => setPaused(previous => !previous)} aria-pressed={paused}>{paused ? "开启动画" : "暂停动画"}</button>
      </div>
    </div>
  </section>;
}
