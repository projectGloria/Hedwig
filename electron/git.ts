import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import type { TokenSource } from "./http";
import { keyFor, within } from "./core";
import { atomicJSON } from "./storage";
export type GitContext = {
  binary: string;
  helper: string;
  runtime: string;
  emptyHooks: string;
  token: TokenSource;
};
export class Git {
  constructor(readonly context: GitContext) {}
  async run(
    args: string[],
    cwd: string | undefined,
    signal: AbortSignal,
    progress?: (line: string) => void,
  ): Promise<string> {
    signal.throwIfAborted();
    const github = await this.context.token("github");
    const gitlab = await this.context.token("gitlab");
    const helper = `!\"${this.context.runtime.replace(/\\/g, "/")}\" \"${this.context.helper.replace(/\\/g, "/")}\"`;
    const configs = [
      "credential.helper=",
      `credential.helper=${helper}`,
      `core.hooksPath=${this.context.emptyHooks}`,
      "protocol.allow=never",
      "protocol.https.allow=always",
      "protocol.file.allow=always",
      "core.longpaths=true",
      "core.autocrlf=false",
      "credential.interactive=false",
      "filter.lfs.clean=git-lfs clean -- %f",
      "filter.lfs.smudge=git-lfs smudge -- %f",
      "filter.lfs.process=git-lfs filter-process",
      "filter.lfs.required=true",
    ];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_LFS_SKIP_SMUDGE: "1",
      ELECTRON_RUN_AS_NODE: "1",
      HEDWIG_GITHUB_TOKEN: github || "",
      HEDWIG_GITLAB_TOKEN: gitlab || "",
    };
    delete env.GIT_CONFIG_COUNT;
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_ASKPASS;
    delete env.SSH_ASKPASS;
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.context.binary,
        [...configs.flatMap((c) => ["-c", c]), ...args],
        { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      let stdout = "";
      let stderr = "";
      let overflow = false;
      const abort = () => {
        if (process.platform === "win32" && child.pid)
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
        else child.kill("SIGTERM");
      };
      signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
        if (stdout.length > 128 * 1024 * 1024) {
          overflow = true;
          abort();
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-8000);
        progress?.(
          chunk
            .toString()
            .trim()
            .split(/[\r\n]/)
            .pop() || "Working…",
        );
      });
      child.on("error", (e) => {
        signal.removeEventListener("abort", abort);
        reject(e);
      });
      child.on("close", (code) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(new Error("Transfer cancelled."));
        else if (overflow)
          reject(
            new Error(
              "Git output exceeds the supported size for this operation.",
            ),
          );
        else if (code !== 0)
          reject(
            new Error(`Git ${args[0]} failed: ${stderr || `exit ${code}`}`),
          );
        else resolve(stdout);
      });
    });
  }
  async mirror(
    url: string,
    folder: string,
    signal: AbortSignal,
    progress: (s: string) => void,
  ) {
    const temp = `${folder}.partial`;
    // Only remove this task-owned temporary sibling after checking its exact parent.
    within(path.dirname(folder), path.basename(temp));
    await fs.rm(temp, { recursive: true, force: true });
    await this.run(
      ["clone", "--bare", "--no-single-branch", "--progress", "--", url, temp],
      undefined,
      signal,
      progress,
    );
    await this.run(
      ["config", "--add", "remote.origin.fetch", "+refs/heads/*:refs/heads/*"],
      temp,
      signal,
    );
    await this.run(
      ["config", "--add", "remote.origin.fetch", "+refs/tags/*:refs/tags/*"],
      temp,
      signal,
    );
    await fs.rename(temp, folder);
  }
  async exists(folder: string) {
    try {
      await fs.access(path.join(folder, "HEAD"));
      return true;
    } catch {
      return false;
    }
  }
  async lfs(
    folder: string,
    signal: AbortSignal,
    progress: (s: string) => void,
  ) {
    await this.run(
      ["lfs", "fetch", "--all", "origin"],
      folder,
      signal,
      progress,
    );
  }
  async checkout(
    mirror: string,
    target: string,
    branch: string,
    signal: AbortSignal,
    progress: (s: string) => void,
  ) {
    const temp = `${target}.partial`;
    within(path.dirname(target), path.basename(temp));
    await fs.rm(temp, { recursive: true, force: true });
    await this.run(
      ["clone", "--no-hardlinks", "--no-checkout", "--", mirror, temp],
      undefined,
      signal,
      progress,
    );
    const heads = (
      await this.run(
        ["for-each-ref", "--format=%(refname)", "refs/heads"],
        mirror,
        signal,
      )
    ).trim();
    if (branch && heads) {
      await this.run(["checkout", branch], temp, signal, progress);
      const lfs = path.join(mirror, "lfs", "objects");
      try {
        await fs.access(lfs);
        await fs.cp(lfs, path.join(temp, ".git", "lfs", "objects"), {
          recursive: true,
        });
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
      await this.run(["lfs", "checkout"], temp, signal, progress);
    }
    await fs.rename(temp, target);
  }
  async submodules(
    rootUrl: string,
    mirror: string,
    destination: string,
    signal: AbortSignal,
    progress: (s: string) => void,
  ) {
    await fs.mkdir(destination, { recursive: true });
    const queue = [{ url: rootUrl, folder: mirror }];
    const scanned = new Set<string>();
    const records: { url: string; folder: string; commits: string[] }[] = [];
    const byUrl = new Map<string, (typeof records)[number]>();
    while (queue.length) {
      signal.throwIfAborted();
      const item = queue.shift()!;
      // Inspect only commits that changed a gitlink or its URL mapping, including root and merge diffs.
      // This avoids spawning one process per commit for repositories with large histories.
      const changes = await this.run(
        [
          "log",
          "--all",
          "--raw",
          "--root",
          "-m",
          "--no-renames",
          "--no-abbrev",
          "--format=commit:%H",
        ],
        item.folder,
        signal,
      );
      const candidates = new Set<string>();
      let current = "";
      for (const line of changes.split("\n")) {
        if (line.startsWith("commit:")) current = line.slice(7).trim();
        else if (
          line.startsWith(":") &&
          (/^:\d{6} 160000 /.test(line) || line.endsWith("\t.gitmodules"))
        )
          candidates.add(current);
      }
      const commits = [...candidates].filter(Boolean);
      const mappings = new Map<string, Record<string, string>>();
      for (const commit of commits) {
        const scanKey = `${item.url}@${commit}`;
        if (scanned.has(scanKey)) continue;
        scanned.add(scanKey);
        progress(`Checking submodules · ${scanned.size} revisions`);
        const tree = (
          await this.run(["ls-tree", "-r", "-z", commit], item.folder, signal)
        )
          .split("\0")
          .filter(Boolean);
        const links = tree.filter((line) => line.startsWith("160000 "));
        if (!links.length) continue;
        const modules = tree.find((line) => line.endsWith("\t.gitmodules"));
        if (!modules)
          throw new Error(
            `Submodule references have no .gitmodules in revision ${commit.slice(0, 8)}.`,
          );
        const blob = modules.split(/\s+/)[2];
        let mapping = mappings.get(blob);
        if (!mapping) {
          const text = await this.run(
            ["config", "--blob", `${commit}:.gitmodules`, "--null", "--list"],
            item.folder,
            signal,
          );
          const entries: Record<string, { path?: string; url?: string }> =
            Object.create(null);
          for (const entry of text.split("\0").filter(Boolean)) {
            const i = entry.indexOf("\n");
            const k = entry.slice(0, i);
            const value = entry.slice(i + 1);
            const match = /^submodule\.(.*)\.(path|url)$/.exec(k);
            if (match) {
              entries[match[1]] ||= {};
              entries[match[1]][match[2] as "path" | "url"] = value;
            }
          }
          mapping = Object.create(null) as Record<string, string>;
          for (const e of Object.values(entries))
            if (e.path && e.url) mapping[e.path] = e.url;
          mappings.set(blob, mapping);
        }
        for (const link of links) {
          const tab = link.indexOf("\t");
          const sha = link.slice(0, tab).split(" ")[2];
          const subPath = link.slice(tab + 1);
          const raw = mapping[subPath];
          if (!raw) throw new Error(`Missing URL for submodule ${subPath}.`);
          const url = resolveSubmodule(item.url, raw);
          const folder = within(destination, keyFor(url));
          let record = byUrl.get(url);
          if (!record) {
            record = { url, folder: path.basename(folder), commits: [] };
            byUrl.set(url, record);
            records.push(record);
          }
          if (record.commits.includes(sha)) continue;
          if (!(await this.exists(folder)))
            await this.mirror(url, folder, signal, progress);
          try {
            await this.run(
              ["cat-file", "-e", `${sha}^{commit}`],
              folder,
              signal,
            );
          } catch {
            await this.run(["fetch", "origin", sha], folder, signal, progress);
          }
          await this.run(
            ["update-ref", `refs/hedwig/submodules/${sha}`, sha],
            folder,
            signal,
          );
          record.commits.push(sha);
          queue.push({ url, folder });
        }
      }
    }
    for (const record of records)
      await this.lfs(within(destination, record.folder), signal, progress);
    await atomicJSON(path.join(destination, "index.json"), records);
  }
  async push(
    mirror: string,
    url: string,
    signal: AbortSignal,
    progress: (s: string) => void,
  ) {
    await this.run(["lfs", "push", "--all", url], mirror, signal, progress);
    const refs = await this.run(
      ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags"],
      mirror,
      signal,
    );
    if (refs.trim())
      await this.run(
        [
          "push",
          "--progress",
          url,
          ...refs
            .trim()
            .split("\n")
            .map((r) => `${r}:${r}`),
        ],
        mirror,
        signal,
        progress,
      );
  }
}
export function resolveSubmodule(parent: string, raw: string) {
  let value = raw;
  if (raw.startsWith("./") || raw.startsWith("../"))
    value = new URL(raw, `${parent}/`).toString();
  else if (/^git@[^:]+:/.test(raw))
    value = raw.replace(/^git@([^:]+):/, "https://$1/");
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash)
    throw new Error(
      "A submodule uses an unsupported URL. Only HTTPS submodule sources can be archived.",
    );
  return u.toString();
}
