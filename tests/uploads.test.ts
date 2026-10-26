import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Providers } from "../electron/providers";
import { Http } from "../electron/http";
import type { Release, UploadTarget } from "../src/shared";
const dirs: string[] = [];
async function file() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hedwig-upload-"));
  dirs.push(dir);
  const filename = path.join(dir, "asset.bin");
  await fs.writeFile(filename, "release payload");
  return filename;
}
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const release: Release = {
  id: "source-release",
  name: "Version one",
  tag: "v1",
  body: "Release notes",
  publishedAt: "2025-01-01T00:00:00Z",
  assets: [],
};
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await fs.rm(dir, { recursive: true, force: true });
});
describe("release uploads", () => {
  it("streams local release bytes to GitHub and uses the destination release ID", async () => {
    const filename = await file();
    const target: UploadTarget = {
      provider: "github",
      account: "me",
      name: "copy",
      repoId: "1",
      releaseId: "42",
      visibility: "private",
      stages: [],
    };
    let payload = "";
    const fetcher = vi.fn(async (url: any, init: any) => {
      if (String(url).startsWith("https://api.github.com")) return json([]);
      expect(String(url)).toBe(
        "https://uploads.github.com/repos/me/copy/releases/42/assets?name=asset.bin",
      );
      expect(init.method).toBe("POST");
      for await (const chunk of init.body) payload += chunk.toString();
      return json({ id: 10 }, 201);
    });
    await new Providers(
      new Http(async () => "secret", fetcher as any),
    ).uploadAsset(
      target,
      release,
      { id: "1", name: "asset.bin", url: "https://github.com/original" },
      filename,
      new AbortController().signal,
    );
    expect(payload).toBe("release payload");
  });
  it("copies GitLab assets into its package registry and links the copy", async () => {
    const filename = await file();
    const target: UploadTarget = {
      provider: "gitlab",
      account: "me",
      name: "copy",
      repoId: "77",
      releaseId: "v1",
      visibility: "private",
      stages: [],
    };
    let packageUrl = "";
    let payload = "";
    let link: any;
    const fetcher = vi.fn(async (url: any, init: any) => {
      if (init.method === "HEAD") return new Response(null, { status: 404 });
      if (init.method === "PUT") {
        packageUrl = String(url);
        for await (const chunk of init.body) payload += chunk.toString();
        return json({}, 201);
      }
      if (init.method === "POST") {
        link = JSON.parse(init.body);
        return json({ id: 1 }, 201);
      }
      return json([]);
    });
    await new Providers(
      new Http(async () => "secret", fetcher as any),
    ).uploadAsset(
      target,
      release,
      { id: "1", name: "asset.bin", url: "https://original.example.org/a" },
      filename,
      new AbortController().signal,
    );
    expect(payload).toBe("release payload");
    expect(packageUrl).toContain(
      "/projects/77/packages/generic/hedwig-release/",
    );
    expect(link.url).toBe(packageUrl);
    expect(link.url).not.toContain("original.example.org");
  });
  it("reconciles a lost repository-create response only with its persisted unique marker", async () => {
    const target: UploadTarget = {
      provider: "github",
      name: "copy",
      account: "me",
      visibility: "private",
      stages: [],
      creationKey: "unique-intent",
    };
    const fetcher = vi.fn(async () =>
      json({
        id: 42,
        description: "Archived with Hedwig · transfer unique-intent",
        html_url: "https://github.com/me/copy",
        clone_url: "https://github.com/me/copy.git",
      }),
    );
    expect(
      (
        await new Providers(
          new Http(async () => "token", fetcher as any),
        ).create(target)
      ).repoId,
    ).toBe("42");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
