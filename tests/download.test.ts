import { afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { downloadAsset } from "../electron/download";
import { Http } from "../electron/http";
const dirs: string[] = [];
async function destination() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hedwig-download-"));
  dirs.push(dir);
  return path.join(dir, "asset.bin");
}
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await fs.rm(dir, { recursive: true, force: true });
});
describe("asset transfers", () => {
  it("does not promote a partial range that ends before the declared total", async () => {
    const file = await destination();
    const http = new Http(
      async () => undefined,
      vi.fn(
        async () =>
          new Response("short", {
            status: 206,
            headers: { "content-range": "bytes 0-4/10", "content-length": "5" },
          }),
      ) as any,
    );
    await expect(
      downloadAsset(
        http,
        { id: "1", name: "a", url: "https://cdn.example.com/a" },
        file,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("size");
    await expect(fs.access(file)).rejects.toThrow();
  });
  it("streams and verifies a SHA-256 digest", async () => {
    const file = await destination();
    const data = Buffer.from("a verified release");
    const sha = createHash("sha256").update(data).digest("hex");
    const http = new Http(
      async () => undefined,
      vi.fn(async () => new Response(data)) as any,
    );
    await downloadAsset(
      http,
      {
        id: "1",
        name: "asset",
        url: "https://cdn.example.com/a",
        size: data.length,
        digest: `sha256:${sha}`,
      },
      file,
      new AbortController().signal,
      () => {},
    );
    expect(await fs.readFile(file, "utf8")).toBe(data.toString());
  });
  it("resumes using a validated range and ETag", async () => {
    const file = await destination();
    await fs.writeFile(`${file}.partial`, "hello ");
    await fs.writeFile(
      `${file}.partial.json`,
      JSON.stringify({ etag: '"v1"' }),
    );
    const fetcher = vi.fn(async (_url: any, init: any) => {
      expect(new Headers(init.headers).get("Range")).toBe("bytes=6-");
      expect(new Headers(init.headers).get("If-Range")).toBe('"v1"');
      return new Response("world", {
        status: 206,
        headers: {
          "content-range": "bytes 6-10/11",
          "content-length": "5",
          etag: '"v1"',
        },
      });
    });
    await downloadAsset(
      new Http(async () => undefined, fetcher as any),
      { id: "1", name: "a", url: "https://cdn.example.com/a", size: 11 },
      file,
      new AbortController().signal,
      () => {},
    );
    expect(await fs.readFile(file, "utf8")).toBe("hello world");
  });
  it("restarts if the server ignores the range", async () => {
    const file = await destination();
    await fs.writeFile(`${file}.partial`, "old");
    await fs.writeFile(
      `${file}.partial.json`,
      JSON.stringify({ etag: '"v0"' }),
    );
    const http = new Http(
      async () => undefined,
      vi.fn(async () => new Response("new content")) as any,
    );
    await downloadAsset(
      http,
      { id: "1", name: "a", url: "https://cdn.example.com/a" },
      file,
      new AbortController().signal,
      () => {},
    );
    expect(await fs.readFile(file, "utf8")).toBe("new content");
  });
  it("deletes a corrupt partial instead of promoting it", async () => {
    const file = await destination();
    const http = new Http(
      async () => undefined,
      vi.fn(async () => new Response("corrupt")) as any,
    );
    await expect(
      downloadAsset(
        http,
        {
          id: "1",
          name: "a",
          url: "https://cdn.example.com/a",
          digest: `sha256:${"0".repeat(64)}`,
        },
        file,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("checksum");
    await expect(fs.access(file)).rejects.toThrow();
    await expect(fs.access(`${file}.partial`)).rejects.toThrow();
  });
  it("does not promote an interrupted asset", async () => {
    const file = await destination();
    const controller = new AbortController();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("partial"));
      },
      cancel() {},
    });
    const http = new Http(
      async () => undefined,
      vi.fn(
        async () => new Response(stream, { headers: { etag: '"v1"' } }),
      ) as any,
    );
    await expect(
      downloadAsset(
        http,
        { id: "1", name: "a", url: "https://cdn.example.com/a" },
        file,
        controller.signal,
        () => {
          setTimeout(() => controller.abort(), 20);
        },
      ),
    ).rejects.toThrow();
    await expect(fs.access(file)).rejects.toThrow();
  });
});
