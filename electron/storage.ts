import fs from "node:fs/promises";
import path from "node:path";
import type { Job, Settings } from "../src/shared";
export async function atomicJSON(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2));
  await fs.rename(`${file}.tmp`, file);
}
export async function readJSON<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e: any) {
    if (e.code === "ENOENT") return fallback;
    throw new Error(
      `Cannot read saved data: ${path.basename(file)}. Preserve this file before resetting the app.`,
    );
  }
}
export class Store {
  jobs: Job[] = [];
  settings: Settings;
  private writes: Promise<void> = Promise.resolve();
  constructor(
    readonly root: string,
    downloads: string,
  ) {
    this.settings = {
      destination: downloads,
      githubClientId: "",
      gitlabClientId: "",
    };
  }
  async init() {
    this.settings = await readJSON(
      path.join(this.root, "settings.json"),
      this.settings,
    );
    this.jobs = await readJSON<Job[]>(path.join(this.root, "jobs.json"), []);
    for (const j of this.jobs)
      if (j.status === "running" || j.status === "queued") {
        j.status = "failed";
        j.stage = "Interrupted";
        j.error = "The app closed during this transfer. Retry to continue.";
      }
    await this.save();
  }
  save() {
    const jobs = structuredClone(this.jobs);
    const settings = { ...this.settings };
    const next = this.writes
      .catch(() => {})
      .then(async () => {
        await atomicJSON(path.join(this.root, "jobs.json"), jobs);
        await atomicJSON(path.join(this.root, "settings.json"), settings);
      });
    this.writes = next;
    return next;
  }
}
