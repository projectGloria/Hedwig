import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Job, Provider, Repository } from "../src/shared";
import { Store, atomicJSON, readJSON } from "./storage";
import { Providers } from "./providers";
import { Git } from "./git";
import { assetNames, publicError, safeName, within } from "./core";
import { downloadAsset, hashFile } from "./download";
type Manifest = {
  version: 1;
  repository: Repository;
  stages: string[];
  assets: Record<string, { name: string; size: number; sha256: string }>;
  completed: boolean;
};
export class Jobs {
  private controllers = new Map<string, AbortController>();
  private queue = Promise.resolve();
  private lastEmit = 0;
  constructor(
    readonly store: Store,
    readonly providers: Providers,
    readonly git: Git,
    readonly changed: () => void,
  ) {}
  find(id: string) {
    const job = this.store.jobs.find((j) => j.id === id);
    if (!job) throw new Error("Transfer not found.");
    return job;
  }
  async addDownload(repo: Repository, destination: string) {
    await fs.mkdir(destination, { recursive: true });
    const id = randomUUID();
    const folder = within(
      destination,
      `${safeName(repo.name)}-${id.slice(0, 8)}`,
    );
    await fs.mkdir(folder);
    if (repo.release) {
      const names = assetNames(repo.release.assets);
      repo.release.assets.forEach((a, i) => (a.localName = names[i]));
    }
    const now = new Date().toISOString();
    const job: Job = {
      id,
      repo,
      folder,
      kind: "download",
      createdAt: now,
      updatedAt: now,
      status: "queued",
      stage: "Waiting",
      completedAssets: [],
    };
    this.store.jobs.unshift(job);
    await this.store.save();
    this.changed();
    this.schedule(job);
    return id;
  }
  async addUpload(
    sourceId: string,
    provider: Provider,
    name: string,
    visibility: "private" | "public",
  ) {
    const source = this.find(sourceId);
    if (source.kind !== "download" || source.status !== "completed")
      throw new Error("Finish downloading the repository before uploading.");
    const identity = await this.providers.identity(provider);
    const now = new Date().toISOString();
    const job: Job = {
      id: randomUUID(),
      kind: "upload",
      sourceJobId: sourceId,
      repo: structuredClone(source.repo),
      folder: source.folder,
      status: "queued",
      stage: "Waiting",
      createdAt: now,
      updatedAt: now,
      completedAssets: [],
      target: {
        provider,
        name,
        visibility,
        account: identity.login,
        stages: [],
      },
    };
    this.store.jobs.unshift(job);
    await this.store.save();
    this.changed();
    this.schedule(job);
    return job.id;
  }
  async cancel(id: string) {
    const job = this.find(id);
    this.controllers.get(id)?.abort();
    if (job.status === "queued") {
      job.status = "cancelled";
      job.stage = "Cancelled";
      await this.store.save();
      this.changed();
    }
  }
  async retry(id: string) {
    const job = this.find(id);
    if (
      !["failed", "cancelled"].includes(job.status) ||
      this.controllers.has(id)
    )
      throw new Error("This transfer cannot be retried yet.");
    job.status = "queued";
    job.error = undefined;
    job.stage = "Waiting to retry";
    await this.store.save();
    this.changed();
    this.schedule(job);
  }
  busy() {
    return this.controllers.size > 0;
  }
  stopAll() {
    for (const controller of this.controllers.values()) controller.abort();
  }
  private progress(job: Job, stage: string, bytes?: number, total?: number) {
    job.stage = stage;
    job.bytes = bytes;
    job.total = total;
    job.updatedAt = new Date().toISOString();
    if (Date.now() - this.lastEmit > 150) {
      this.lastEmit = Date.now();
      this.changed();
    }
  }
  private schedule(job: Job) {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        if (controller.signal.aborted) {
          this.controllers.delete(job.id);
          return;
        }
        try {
          job.status = "running";
          await this.store.save();
          this.changed();
          if (job.kind === "download")
            await this.download(job, controller.signal);
          else await this.upload(job, controller.signal);
          job.status = "completed";
          job.stage =
            job.kind === "download" ? "Archive ready" : "Upload complete";
          job.error = undefined;
        } catch (e) {
          job.status = controller.signal.aborted ? "cancelled" : "failed";
          job.error = publicError(e);
          job.stage = controller.signal.aborted
            ? "Cancelled"
            : "Needs attention";
        } finally {
          this.controllers.delete(job.id);
          job.updatedAt = new Date().toISOString();
          job.bytes = undefined;
          job.total = undefined;
          try {
            await this.store.save();
          } catch (e) {
            job.status = "failed";
            job.error = `Could not save transfer history: ${publicError(e)}`;
          }
          this.changed();
        }
      });
  }
  private async download(job: Job, signal: AbortSignal) {
    const file = within(job.folder, "manifest.json");
    const manifest = await readJSON<Manifest>(file, {
      version: 1,
      repository: job.repo,
      stages: [],
      assets: {},
      completed: false,
    });
    await atomicJSON(file, manifest);
    const checkpoint = async (stage: string) => {
      if (!manifest.stages.includes(stage)) manifest.stages.push(stage);
      await atomicJSON(file, manifest);
      await this.store.save();
      this.changed();
    };
    const mirror = within(job.folder, "repository.git");
    const report = (s: string) => this.progress(job, s);
    if (!manifest.stages.includes("git")) {
      report("Cloning all branches and tags");
      if (!(await this.git.exists(mirror)))
        await this.git.mirror(job.repo.cloneUrl, mirror, signal, report);
      await checkpoint("git");
    }
    if (!manifest.stages.includes("lfs")) {
      report("Downloading Git LFS objects");
      await this.git.lfs(mirror, signal, report);
      await checkpoint("lfs");
    }
    if (!manifest.stages.includes("submodules")) {
      report("Archiving submodule history");
      await this.git.submodules(
        job.repo.cloneUrl,
        mirror,
        within(job.folder, "submodules"),
        signal,
        report,
      );
      await checkpoint("submodules");
    }
    if (!manifest.stages.includes("checkout")) {
      report("Preparing browsable source files");
      const folder = within(job.folder, "source");
      try {
        await fs.access(path.join(folder, ".git"));
      } catch {
        await this.git.checkout(
          mirror,
          folder,
          job.repo.defaultBranch,
          signal,
          report,
        );
      }
      await checkpoint("checkout");
    }
    const release = job.repo.release;
    if (release) {
      const assetsFolder = within(job.folder, "release", "assets");
      await fs.mkdir(assetsFolder, { recursive: true });
      await atomicJSON(within(job.folder, "release", "release.json"), release);
      await fs.writeFile(
        within(job.folder, "release", "RELEASE_NOTES.md"),
        release.body,
      );
      for (const asset of release.assets) {
        signal.throwIfAborted();
        const name = asset.localName!;
        const dest = within(assetsFolder, name);
        const existing = manifest.assets[asset.id];
        if (existing) {
          try {
            if ((await hashFile(dest, signal)) === existing.sha256) continue;
          } catch {}
        }
        const receipt = await downloadAsset(
          this.providers.http,
          asset,
          dest,
          signal,
          (bytes, total) =>
            this.progress(job, `Downloading ${name}`, bytes, total),
        );
        manifest.assets[asset.id] = { name, ...receipt };
        if (!job.completedAssets.includes(asset.id))
          job.completedAssets.push(asset.id);
        await checkpoint("assets-started");
      }
    }
    signal.throwIfAborted();
    manifest.completed = true;
    await checkpoint("complete");
  }
  private async upload(job: Job, signal: AbortSignal) {
    const t = job.target!;
    const report = (s: string) => this.progress(job, s);
    report("Checking destination account");
    const identity = await this.providers.identity(t.provider);
    if (identity.login !== t.account)
      throw new Error(
        `Reconnect the ${t.account} account to resume this upload.`,
      );
    const manifest = await readJSON<Manifest | null>(
      within(job.folder, "manifest.json"),
      null,
    );
    if (!manifest?.completed)
      throw new Error(
        "The local archive is incomplete or missing its manifest.",
      );
    for (const a of Object.values(manifest.assets)) {
      signal.throwIfAborted();
      report(`Verifying ${a.name}`);
      if (
        (await hashFile(
          within(job.folder, "release", "assets", a.name),
          signal,
        )) !== a.sha256
      )
        throw new Error(
          `Local asset ${a.name} has changed. Download a new archive before uploading.`,
        );
    }
    const checkpoint = async (stage: string) => {
      if (!t.stages.includes(stage)) t.stages.push(stage);
      await this.store.save();
      this.changed();
    };
    if (job.repo.release) {
      try {
        await this.git.run(
          [
            "rev-parse",
            "--verify",
            `refs/tags/${job.repo.release.tag}^{commit}`,
          ],
          within(job.folder, "repository.git"),
          signal,
        );
      } catch {
        signal.throwIfAborted();
        throw new Error(
          "The release tag is missing from the local archive. Download a fresh archive before uploading this release.",
        );
      }
    }
    if (!t.repoId) {
      report("Creating destination repository");
      t.creationKey ||= randomUUID();
      await this.store.save();
      Object.assign(t, await this.providers.create(t, signal));
      await checkpoint("created");
    } else {
      const existing = await this.providers.findTarget(t, signal);
      if (!existing || String(existing.id) !== t.repoId)
        throw new Error(
          "The original upload destination was deleted or replaced. Start a new upload.",
        );
    }
    if (!t.stages.includes("git")) {
      report("Uploading Git history and LFS");
      await this.git.push(
        within(job.folder, "repository.git"),
        t.cloneUrl!,
        signal,
        report,
      );
      await checkpoint("git");
    }
    if (!t.stages.includes("default-branch")) {
      const heads = await this.git.run(
        ["for-each-ref", "--format=%(refname)", "refs/heads"],
        within(job.folder, "repository.git"),
        signal,
      );
      if (heads.trim())
        await this.providers.defaultBranch(t, job.repo.defaultBranch, signal);
      await checkpoint("default-branch");
    }
    const release = job.repo.release;
    if (release) {
      if (!t.releaseId) {
        report("Creating release");
        t.releaseId = await this.providers.release(t, release, signal);
        await checkpoint("release");
      }
      for (const asset of release.assets) {
        signal.throwIfAborted();
        if (job.completedAssets.includes(asset.id)) continue;
        report(`Uploading ${asset.localName}`);
        await this.providers.uploadAsset(
          t,
          release,
          asset,
          within(job.folder, "release", "assets", asset.localName!),
          signal,
        );
        job.completedAssets.push(asset.id);
        await checkpoint(`asset:${asset.id}`);
      }
    }
    signal.throwIfAborted();
    await checkpoint("complete");
  }
}
