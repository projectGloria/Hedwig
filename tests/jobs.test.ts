import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store, atomicJSON } from "../electron/storage";
import { Jobs } from "../electron/jobs";
import { Providers } from "../electron/providers";
import { Http } from "../electron/http";
import { parseRepo } from "../electron/core";
import type { Job, Repository } from "../src/shared";
const dirs: string[] = [];
async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hedwig-jobs-"));
  dirs.push(dir);
  const store = new Store(path.join(dir, "state"), dir);
  await store.init();
  return { dir, store };
}
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await fs.rm(dir, { recursive: true, force: true });
});
const repository: Repository = {
  ...parseRepo("https://github.com/owner/repo"),
  id: "1",
  description: "",
  private: false,
  stars: 0,
  defaultBranch: "main",
  release: null,
};
async function finish(jobs: Jobs) {
  const limit = Date.now() + 10_000;
  while (jobs.busy() && Date.now() < limit)
    await new Promise((resolve) => setTimeout(resolve, 10));
  if (jobs.busy()) throw new Error("Job did not finish.");
}
describe("persistent transfer jobs", () => {
  it("marks a running job interrupted after reopening", async () => {
    const { dir, store } = await setup();
    store.jobs.push({
      id: "interrupted",
      repo: repository,
      folder: dir,
      kind: "download",
      status: "running",
      stage: "Cloning",
      createdAt: "",
      updatedAt: "",
      completedAssets: [],
    });
    await store.save();
    const reopened = new Store(store.root, dir);
    await reopened.init();
    expect(reopened.jobs[0].status).toBe("failed");
    expect(reopened.jobs[0].error).toContain("Retry");
  });
  it("retries only failed upload stages against the same destination", async () => {
    const { dir, store } = await setup();
    await atomicJSON(path.join(dir, "manifest.json"), {
      version: 1,
      repository,
      completed: true,
      assets: {},
      stages: [],
    });
    const source: Job = {
      id: "source",
      repo: repository,
      folder: dir,
      kind: "download",
      status: "completed",
      stage: "Archive ready",
      createdAt: "",
      updatedAt: "",
      completedAssets: [],
    };
    store.jobs.push(source);
    const providers = new Providers(new Http(async () => undefined));
    vi.spyOn(providers, "identity").mockResolvedValue({ login: "me", id: 2 });
    const create = vi.spyOn(providers, "create").mockResolvedValue({
      repoId: "9",
      url: "https://github.com/me/copy",
      cloneUrl: "https://github.com/me/copy.git",
    });
    vi.spyOn(providers, "findTarget").mockResolvedValue({ id: 9 });
    const branch = vi
      .spyOn(providers, "defaultBranch")
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValue(undefined);
    const push = vi.fn().mockResolvedValue(undefined);
    const jobs = new Jobs(
      store,
      providers,
      { push, run: vi.fn().mockResolvedValue("refs/heads/main") } as any,
      () => {},
    );
    const id = await jobs.addUpload("source", "github", "copy", "private");
    await finish(jobs);
    expect(jobs.find(id).status).toBe("failed");
    expect(jobs.find(id).target?.repoId).toBe("9");
    await jobs.retry(id);
    await finish(jobs);
    expect(jobs.find(id).status).toBe("completed");
    expect(create).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(branch).toHaveBeenCalledTimes(2);
  });
  it("rejects retry if the original destination was replaced", async () => {
    const { dir, store } = await setup();
    await atomicJSON(path.join(dir, "manifest.json"), {
      completed: true,
      assets: {},
    });
    const providers = new Providers(new Http(async () => undefined));
    vi.spyOn(providers, "identity").mockResolvedValue({ login: "me", id: 2 });
    vi.spyOn(providers, "findTarget").mockResolvedValue({ id: 999 });
    const j: Job = {
      id: "job",
      repo: repository,
      folder: dir,
      kind: "upload",
      status: "failed",
      stage: "",
      createdAt: "",
      updatedAt: "",
      completedAssets: [],
      target: {
        provider: "github",
        account: "me",
        name: "copy",
        visibility: "private",
        stages: [],
        repoId: "9",
      },
    };
    store.jobs.push(j);
    const jobs = new Jobs(store, providers, {} as any, () => {});
    await jobs.retry(j.id);
    await finish(jobs);
    expect(jobs.find(j.id).error).toContain("deleted or replaced");
  });
});
