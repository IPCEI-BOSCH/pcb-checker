import JSZip from "jszip";

/** Browser memory budgets; batch archives may be split into smaller groups. */
export interface ZipLimits {
  compressedBytes: number;
  entryBytes: number;
  totalBytes: number;
  entries: number;
  compressionRatio: number;
}
export const ZIP_LIMITS: Readonly<ZipLimits> = Object.freeze({
  compressedBytes: 128 * 1024 * 1024,
  entryBytes: 16 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  entries: 10_000,
  compressionRatio: 200,
});

export class ZipSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipSecurityError";
  }
}

const invalid = () =>
  new ZipSecurityError(
    "Arhiva ZIP este deteriorată sau folosește un format nesuportat. Reexportați-o ca ZIP standard (fără ZIP64 sau criptare).",
  );

/** Reject, do not silently repair paths: JSZip strips ../ before exposing names. */
export function validateZipPath(name: string): string {
  const control = [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  if (!name || name.length > 1024 || control || /[\\:]/.test(name) || name.startsWith("/")) {
    throw new ZipSecurityError(
      "Arhiva conține o cale nesigură sau absolută. Eliminați căile de sistem din ZIP.",
    );
  }
  const parts = name.replace(/\/$/, "").split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || /[. ]$/.test(p))) {
    throw new ZipSecurityError(
      "Arhiva conține o cale nesigură (../ sau directoare ambigue). Refaceți ZIP-ul din folderul proiectelor.",
    );
  }
  return name.normalize("NFC").toLowerCase();
}

interface EntrySize {
  name: string;
  compressed: number;
  expanded: number;
}

// JSZip 3.10 exposes this API at runtime but omits it on JSZipObject in index.d.ts.
type StreamingEntry = JSZip.JSZipObject & {
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
};

/** Read ZIP32 central directory before any library normalizes paths or inflates. */
export function inspectZip(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): EntrySize[] {
  if (bytes.byteLength > limits.compressedBytes) {
    throw new ZipSecurityError(
      "Arhiva ZIP este prea mare (maximum 128 MiB). Împărțiți proiectele în arhive mai mici.",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => view.getUint16(p, true);
  const u32 = (p: number) => view.getUint32(p, true);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 22 - 65535); p--) {
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) {
      end = p;
      break;
    }
  }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw invalid();
  const count = u16(end + 10),
    size = u32(end + 12),
    start = u32(end + 16);
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff || start + size !== end)
    throw invalid();
  if (count > limits.entries)
    throw new ZipSecurityError(
      "Arhiva conține prea multe fișiere/directoare (maximum 10.000). Împărțiți-o pe grupe.",
    );
  const names = new Set<string>();
  const entries: EntrySize[] = [];
  const ranges: [number, number][] = [];
  let pos = start,
    total = 0;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (pos + 46 > end || u32(pos) !== 0x02014b50) throw invalid();
    const flags = u16(pos + 8),
      method = u16(pos + 10);
    const compressed = u32(pos + 20),
      expanded = u32(pos + 24);
    const nameLen = u16(pos + 28),
      extraLen = u16(pos + 30),
      commentLen = u16(pos + 32);
    const local = u32(pos + 42);
    const next = pos + 46 + nameLen + extraLen + commentLen;
    if (
      next > end ||
      flags & 0x41 ||
      ![0, 8].includes(method) ||
      u16(pos + 34) ||
      compressed === 0xffffffff ||
      expanded === 0xffffffff ||
      local === 0xffffffff ||
      local + 30 > start ||
      u32(local) !== 0x04034b50
    )
      throw invalid();
    // Unix symlinks must not be imported as fabrication files.
    if (((u32(pos + 38) >>> 16) & 0xf000) === 0xa000) throw invalid();
    const rawName = bytes.subarray(pos + 46, pos + 46 + nameLen);
    const name = validateZipPath(decoder.decode(rawName));
    if (names.has(name))
      throw new ZipSecurityError(
        "Arhiva conține căi duplicate sau ambigue. Păstrați un singur fișier pentru fiecare cale.",
      );
    names.add(name);
    const localNameLen = u16(local + 26),
      localExtra = u16(local + 28);
    const dataStart = local + 30 + localNameLen + localExtra;
    if (
      dataStart + compressed > start ||
      localNameLen !== nameLen ||
      u16(local + 6) !== flags ||
      u16(local + 8) !== method ||
      rawName.some((b, j) => b !== bytes[local + 30 + j])
    )
      throw invalid();
    if (!(flags & 8) && (u32(local + 18) !== compressed || u32(local + 22) !== expanded))
      throw invalid();
    // Reject Unicode-path overrides rather than permit a second, unvalidated name.
    for (const [from, length] of [
      [pos + 46 + nameLen, extraLen],
      [local + 30 + localNameLen, localExtra],
    ]) {
      let p = from!;
      const stop = p + length!;
      while (p < stop) {
        if (p + 4 > stop) throw invalid();
        const tag = u16(p),
          n = u16(p + 2);
        if (tag === 0x0001) throw invalid(); // ZIP64
        if (tag === 0x7075) {
          if (n < 5 || p + 4 + n > stop) throw invalid();
          const alternate = decoder.decode(bytes.subarray(p + 9, p + 4 + n));
          validateZipPath(alternate);
          if (alternate !== decoder.decode(rawName)) throw invalid();
        }
        p += 4 + n;
      }
      if (p !== stop) throw invalid();
    }
    if (
      expanded > limits.entryBytes ||
      (expanded > 0 && expanded / Math.max(1, compressed) > limits.compressionRatio)
    ) {
      throw new ZipSecurityError(
        "Arhiva depășește limita de siguranță per fișier (16 MiB sau raport de compresie 200:1). Posibil ZIP-bomb.",
      );
    }
    total += expanded;
    if (total > limits.totalBytes)
      throw new ZipSecurityError(
        "Arhiva depășește limita totală dezarhivată (512 MiB). Împărțiți proiectele în arhive mai mici.",
      );
    ranges.push([local, dataStart + compressed]);
    entries.push({ name, compressed, expanded });
    pos = next;
  }
  if (pos !== end) throw invalid();
  ranges.sort((a, b) => a[0] - b[0]);
  if (ranges.some((range, i) => i > 0 && range[0] < ranges[i - 1]![1])) throw invalid();
  return entries;
}

/** Check actual inflated bytes incrementally; never use checkCRC32 (it eagerly inflates everything). */
export async function loadSafeZip(file: Blob, limits: ZipLimits = ZIP_LIMITS): Promise<JSZip> {
  if (file.size > limits.compressedBytes)
    throw new ZipSecurityError("Arhiva ZIP este prea mare (maximum 128 MiB).");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sizes = inspectZip(bytes, limits);
  try {
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files);
    if (entries.length !== sizes.length) throw invalid();
    const byPath = new Map(sizes.map((entry) => [entry.name, entry]));
    let total = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const expected = byPath.get(validateZipPath(entry.name));
      if (!expected) throw invalid();
      if (entry.dir) {
        if (expected.expanded !== 0) throw invalid();
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        let actual = 0,
          failed = false;
        const stream = (entry as StreamingEntry).internalStream("uint8array");
        stream.on("data", (chunk) => {
          actual += chunk.length;
          total += chunk.length;
          if (
            actual > expected.expanded ||
            actual > limits.entryBytes ||
            total > limits.totalBytes
          ) {
            failed = true;
            stream.pause();
            reject(
              new ZipSecurityError(
                "Decomprimarea a depășit limitele de siguranță. Arhiva a fost oprită (posibil ZIP-bomb).",
              ),
            );
          }
        });
        stream.on("error", reject);
        stream.on("end", () => {
          if (!failed) {
            if (actual !== expected.expanded) reject(invalid());
            else resolve();
          }
        });
        stream.resume();
      });
    }
    return zip;
  } catch (error) {
    if (error instanceof ZipSecurityError) throw error;
    throw invalid();
  }
}
