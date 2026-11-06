import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
export async function downloadMedia(address: string, limit: number) {
  const url = new URL(address);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("媒体地址必须使用 HTTPS");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!ips.length || ips.some(({ address }) => {
    if (address.includes(":")) return !/^2[0-9a-f]{3}:/i.test(address);
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && b === 168 || a === 100 && b! >= 64 && b! <= 127 || a! >= 224;
  })) throw new Error("禁止访问本机或内网媒体地址");
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`媒体下载失败 HTTP ${response.status}`);
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > limit) { await reader.cancel(); throw new Error("媒体文件超过大小上限"); } chunks.push(value); }
  return Buffer.concat(chunks);
}
