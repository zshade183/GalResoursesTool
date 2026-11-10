export function arkLocalImage(dataUrl: string) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) throw new Error("参考图必须是 PNG、JPEG 或 WebP。");
  const format = match[1]!;
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length > 30 * 1024 * 1024) throw new Error("单张参考图超过 30 MB。");
  let width = 0;
  let height = 0;
  let alpha = false;
  if (format === "png" && bytes.length >= 26 && bytes.toString("hex", 0, 8) === "89504e470d0a1a0a" && bytes.toString("ascii", 12, 16) === "IHDR") {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
    alpha = bytes[25] === 4 || bytes[25] === 6;
    if (!alpha) {
      for (let offset = 8; offset + 12 <= bytes.length; ) {
        const type = bytes.toString("ascii", offset + 4, offset + 8);
        if (type === "tRNS") { alpha = true; break; }
        if (type === "IDAT" || type === "IEND") break;
        offset += 12 + bytes.readUInt32BE(offset);
      }
    }
  } else if (format === "jpeg" && bytes[0] === 255 && bytes[1] === 216) {
    for (let offset = 2; offset + 4 <= bytes.length && bytes[offset] === 255; ) {
      const marker = bytes[offset + 1]!;
      if (marker === 255) { offset++; continue; }
      if (marker === 217 || marker === 218) break;
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 5);
        width = bytes.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + length;
    }
  } else if (format === "webp" && bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    switch (bytes.toString("ascii", 12, 16)) {
      case "VP8X":
        width = bytes.readUIntLE(24, 3) + 1;
        height = bytes.readUIntLE(27, 3) + 1;
        alpha = Boolean(bytes[20]! & 16);
        break;
      case "VP8L":
        if (bytes[20] === 47) {
          const dimensions = bytes.readUInt32LE(21);
          width = (dimensions & 0x3fff) + 1;
          height = ((dimensions >>> 14) & 0x3fff) + 1;
          alpha = Boolean(dimensions & 0x10000000);
        }
        break;
      case "VP8 ":
        if (bytes.toString("hex", 23, 26) === "9d012a") {
          width = bytes.readUInt16LE(26) & 0x3fff;
          height = bytes.readUInt16LE(28) & 0x3fff;
        }
        break;
    }
  }
  if (!width || !height) throw new Error("无法读取参考图尺寸，请重新导入图片。");
  return { format, width, height, ratio: width / height, alpha };
}
