import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  inspectZip,
  loadSafeZip,
  validateZipPath,
  ZIP_LIMITS,
  ZipSecurityError,
} from "./zipSecurity";

async function archive(files: Record<string, string>, compression: "STORE" | "DEFLATE" = "STORE") {
  const zip = new JSZip();
  for (const [name, value] of Object.entries(files))
    zip.file(name, value, { createFolders: false });
  return zip.generateAsync({ type: "uint8array", compression });
}
const blob = (bytes: Uint8Array) => new Blob([new Uint8Array(bytes)]);
const central = (bytes: Uint8Array) => {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return v.getUint32(bytes.length - 6, true);
};

describe("bounded ZIP import", () => {
  it("accepts nested and Unicode project archives with STORE/DEFLATE", async () => {
    for (const compression of ["STORE", "DEFLATE"] as const) {
      const bytes = await archive(
        { "Seria A/431A/Ștefan/Layout/TOP.art": "G04 test*\nM02*", "root.drl": "M48\nM30" },
        compression,
      );
      const zip = await loadSafeZip(blob(bytes));
      expect(Object.keys(zip.files)).toHaveLength(2);
    }
  });
  it("accepts an explicit empty directory and an empty ZIP", async () => {
    const zip = new JSZip();
    zip.folder("empty");
    await expect(
      loadSafeZip(blob(await zip.generateAsync({ type: "uint8array" }))),
    ).resolves.toBeDefined();
    await expect(loadSafeZip(blob(await archive({})))).resolves.toBeDefined();
  });
  it("maps sizes by path even when JS object enumeration reorders numeric names", async () => {
    const zip = new JSZip();
    zip.file("10", "longer");
    zip.file("2", "x");
    const bytes = await zip.generateAsync({ type: "uint8array" });
    await expect(loadSafeZip(blob(bytes))).resolves.toBeDefined();
  });
  it("rejects traversal before JSZip strips its original path", async () => {
    for (const path of [
      "../TOP.art",
      "foo/../TOP.art",
      "/TOP.art",
      "C:/TOP.art",
      "foo\\TOP.art",
      "foo//TOP.art",
      "foo/./TOP.art",
    ]) {
      await expect(loadSafeZip(blob(await archive({ [path]: "bad" })))).rejects.toBeInstanceOf(
        ZipSecurityError,
      );
    }
  });
  it("rejects unsafe aliases and case-insensitive duplicates", async () => {
    for (const path of ["foo./TOP.art", "foo /TOP.art", "foo/\0TOP.art"])
      expect(() => validateZipPath(path)).toThrow(ZipSecurityError);
    await expect(
      loadSafeZip(blob(await archive({ "TOP.art": "a", "top.art": "b" }))),
    ).rejects.toThrow(/duplicate/);
  });
  it("enforces entry count, compressed, entry and total size budgets", async () => {
    const bytes = await archive({ "TOP.art": "1234", "BOTTOM.art": "5678" });
    for (const limits of [
      { ...ZIP_LIMITS, entries: 1 },
      { ...ZIP_LIMITS, compressedBytes: 1 },
      { ...ZIP_LIMITS, entryBytes: 3 },
      { ...ZIP_LIMITS, totalBytes: 7 },
    ])
      expect(() => inspectZip(bytes, limits)).toThrow(ZipSecurityError);
  });
  it("rejects highly compressed payloads", async () => {
    const bytes = await archive({ "TOP.art": "0".repeat(100_000) }, "DEFLATE");
    await expect(loadSafeZip(blob(bytes))).rejects.toThrow(/ZIP-bomb/);
  });
  it("accepts standard streaming ZIP data descriptors", async () => {
    const zip = new JSZip();
    zip.file("TOP.art", "G04 streaming*\nM02*");
    const bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      streamFiles: true,
    });
    await expect(loadSafeZip(blob(bytes))).resolves.toBeDefined();
  });
  it("rejects ZIP64 markers and multi-disk archives before loading", async () => {
    const source = await archive({ "TOP.art": "data" });
    const zip64 = source.slice();
    new DataView(zip64.buffer).setUint16(zip64.length - 12, 0xffff, true);
    expect(() => inspectZip(zip64)).toThrow(ZipSecurityError);
    const multi = source.slice();
    new DataView(multi.buffer).setUint16(multi.length - 18, 1, true);
    expect(() => inspectZip(multi)).toThrow(ZipSecurityError);
  });
  it("rejects forged inflated sizes incrementally", async () => {
    const bytes = await archive(
      { "TOP.art": "different lines of payload\n".repeat(30) },
      "DEFLATE",
    );
    const v = new DataView(bytes.buffer);
    v.setUint32(22, 1, true);
    v.setUint32(central(bytes) + 24, 1, true);
    await expect(loadSafeZip(blob(bytes))).rejects.toThrow(/siguranță/);
  });
  it("rejects encryption, symlinks, inconsistent names and invalid archives", async () => {
    const source = await archive({ "TOP.art": "data" });
    const encrypted = source.slice();
    new DataView(encrypted.buffer).setUint16(central(encrypted) + 8, 1, true);
    expect(() => inspectZip(encrypted)).toThrow(ZipSecurityError);
    const symlink = source.slice();
    new DataView(symlink.buffer).setUint32(central(symlink) + 38, 0xa1ff0000, true);
    expect(() => inspectZip(symlink)).toThrow(ZipSecurityError);
    const different = source.slice();
    different[30] = 88;
    expect(() => inspectZip(different)).toThrow(ZipSecurityError);
    for (const bytes of [new Uint8Array(), source.subarray(0, 50)]) {
      await expect(loadSafeZip(blob(bytes))).rejects.toThrow(ZipSecurityError);
    }
  });
});
