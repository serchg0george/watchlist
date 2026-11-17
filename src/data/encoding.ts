// ===== Encoding helpers: base64 <-> UTF-8 (safe for Cyrillic and large files) =====

export function base64ToUtf8(b64: string): string {
  const bin = atob(b64); // one char per byte
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  // Chunked to avoid call-stack limits on large strings.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}
