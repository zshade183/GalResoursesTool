import { useEffect, useState } from "react";
export function useRefreshRevision() {
  const [revision, setRevision] = useState(0);
  useEffect(() => { const refresh = () => setRevision(value => value + 1); window.addEventListener("studio-refresh", refresh); return () => window.removeEventListener("studio-refresh", refresh); }, []);
  return revision;
}
export function refreshStudio() { window.dispatchEvent(new Event("studio-refresh")); }
