import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Asset } from "../src/shared";
import { Http } from "./http";
import { atomicJSON, readJSON } from "./storage";
export async function hashFile(file: string, signal?: AbortSignal) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  return hash.digest("hex");
}
export async function downloadAsset(
  http: Http,
  asset: Asset,
  destination: string,
  signal: AbortSignal,
  progress: (bytes: number, total?: number) => void,
) {
  const partial = `${destination}.partial`;
  const metadata = `${partial}.json`;
  let offset = 0;
  try {
    offset = (await fs.stat(partial)).size;
  } catch (e: any) {
    if (e.code !== "ENOENT") throw e;
  }
  const saved = await readJSON<{ etag?: string; modified?: string }>(
    metadata,
    {},
  );
  const validator =
    saved.etag && !saved.etag.startsWith("W/") ? saved.etag : saved.modified;
  if (!validator) offset = 0;
  const headers: Record<string, string> = { "Accept-Encoding": "identity" };
  if (offset) {
    headers.Range = `bytes=${offset}-`;
    headers["If-Range"] = validator!;
  }
  let response = await http.request(
    asset.url,
    { headers, signal },
    "application/octet-stream",
  );
  if (response.status === 416) {
    await response.body?.cancel();
    offset = 0;
    response = await http.request(
      asset.url,
      { headers: { "Accept-Encoding": "identity" }, signal },
      "application/octet-stream",
    );
  }
  await http.check(response);
  if (!response.body)
    throw new Error("The release asset has no download body.");
  let rangeTotal: number | undefined;
  if (response.status === 206) {
    const range = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(
      response.headers.get("content-range") || "",
    );
    if (!range || Number(range[1]) !== offset) {
      await response.body.cancel();
      throw new Error(
        "Invalid resume range from asset server. Retry this transfer.",
      );
    }
    if (range[3] !== "*") rangeTotal = Number(range[3]);
  } else offset = 0;
  await atomicJSON(metadata, {
    etag: response.headers.get("etag") || undefined,
    modified: response.headers.get("last-modified") || undefined,
  });
  const length = response.headers.get("content-length");
  const total = rangeTotal ?? (length ? offset + Number(length) : asset.size);
  let bytes = offset;
  progress(bytes, total);
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      progress(bytes, total);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as any),
    meter,
    createWriteStream(partial, { flags: offset ? "a" : "w" }),
    { signal },
  );
  if (
    (total !== undefined && bytes !== total) ||
    (asset.size !== undefined && bytes !== asset.size)
  )
    throw new Error(
      "Asset size did not match the release metadata. Retry the transfer.",
    );
  if (asset.digest) {
    if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest))
      throw new Error("This asset uses an unsupported digest format.");
    if (
      (await hashFile(partial, signal)) !== asset.digest.slice(7).toLowerCase()
    ) {
      await fs.rm(partial, { force: true });
      await fs.rm(metadata, { force: true });
      throw new Error(
        "Asset checksum mismatch. Retry to download a fresh copy.",
      );
    }
  }
  await fs.rename(partial, destination);
  await fs.rm(metadata, { force: true });
  return { size: bytes, sha256: await hashFile(destination, signal) };
}
