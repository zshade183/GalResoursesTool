import { afterEach, expect, it, vi } from "vitest";
import { downloadMedia } from "./download.js";
afterEach(() => vi.unstubAllGlobals());
it.each(["http://example.com/file", "https://127.0.0.1/a", "https://10.1.2.3/a", "https://[::1]/a", "https://169.254.169.254/a"])("rejects unsafe media URL %s before fetch", async address => {
  const request = vi.fn(); vi.stubGlobal("fetch", request);
  await expect(downloadMedia(address, 100)).rejects.toThrow(); expect(request).not.toHaveBeenCalled();
});
it("limits streamed bytes", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(101))));
  await expect(downloadMedia("https://8.8.8.8/file", 100)).rejects.toThrow("大小上限");
});
