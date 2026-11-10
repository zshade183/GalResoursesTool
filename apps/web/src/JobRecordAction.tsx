import { useState } from "react";
import { refreshStudio } from "./refresh";

const unfinished = new Set(["queued", "submitting", "running", "processing"]);

export function JobRecordAction({ url, state, restore = false, disabled = false, onChanged }: {
  url: string;
  state: string;
  restore?: boolean;
  disabled?: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!restore && unfinished.has(state)) return null;

  async function changeRecord() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(restore ? url + "/restore" : url, { method: restore ? "POST" : "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => undefined) as { message?: string } | undefined;
        throw new Error(body?.message ?? (restore ? "恢复记录失败。" : "删除记录失败。"));
      }
      onChanged();
      refreshStudio();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button type="button" disabled={busy || disabled} onClick={() => void changeRecord()}>
      {busy ? "处理中…" : restore ? "恢复记录" : "删除记录"}
    </button>
    {error && <p role="alert">{error}</p>}
  </>;
}
