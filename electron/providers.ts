import fs from "node:fs";
import { stat } from "node:fs/promises";
import type {
  Provider,
  Repository,
  Release,
  UploadTarget,
  Asset,
} from "../src/shared";
import { parseRepo } from "./core";
import { Http, HttpError, apiBase } from "./http";
export function latestGitlab(releases: any[], now = Date.now()) {
  return releases
    .filter((r) => !r.upcoming_release && Date.parse(r.released_at) <= now)
    .sort((a, b) => Date.parse(b.released_at) - Date.parse(a.released_at))[0];
}
export class Providers {
  constructor(readonly http: Http) {}
  async inspect(url: string, signal?: AbortSignal): Promise<Repository> {
    const ref = parseRepo(url);
    const p = ref.provider;
    const id = p === "github" ? ref.fullName : encodeURIComponent(ref.fullName);
    const base = p === "github" ? `/repos/${id}` : `/projects/${id}`;
    const r = await this.http.json(p, base, { signal });
    let release: Release | null = null;
    if (p === "github") {
      let rel: any;
      try {
        rel = await this.http.json(p, `${base}/releases/latest`, { signal });
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 404) throw e;
      }
      if (rel) {
        const assets = await this.http.pages(
          p,
          `${base}/releases/${rel.id}/assets`,
          signal,
        );
        release = {
          id: String(rel.id),
          tag: rel.tag_name,
          name: rel.name || rel.tag_name,
          body: rel.body || "",
          publishedAt: rel.published_at,
          assets: assets.map((a) => ({
            id: String(a.id),
            name: a.name,
            url: a.url,
            size: a.size,
            digest: a.digest || undefined,
          })),
        };
      }
    } else {
      const releases = await this.http.pages(
        p,
        `${base}/releases?order_by=released_at&sort=desc`,
        signal,
      );
      const rel = latestGitlab(releases);
      if (rel) {
        const links = await this.http.pages(
          p,
          `${base}/releases/${encodeURIComponent(rel.tag_name)}/assets/links`,
          signal,
        );
        release = {
          id: rel.tag_name,
          tag: rel.tag_name,
          name: rel.name || rel.tag_name,
          body: rel.description || "",
          publishedAt: rel.released_at,
          assets: links.map((a) => ({
            id: String(a.id),
            name: a.name,
            url: a.direct_asset_url || a.url,
          })),
        };
      }
    }
    return {
      ...ref,
      id: String(r.id),
      description: r.description || "",
      defaultBranch: r.default_branch || "",
      private: p === "github" ? r.private : r.visibility !== "public",
      stars: r.stargazers_count ?? r.star_count ?? 0,
      release,
    };
  }
  async identity(provider: Provider) {
    const user = await this.http.json(provider, "/user");
    return {
      login: provider === "github" ? user.login : user.username,
      id: user.id,
    };
  }
  async findTarget(target: UploadTarget, signal?: AbortSignal) {
    const endpoint =
      target.provider === "github"
        ? `/repos/${target.account}/${target.name}`
        : `/projects/${encodeURIComponent(`${target.account}/${target.name}`)}`;
    try {
      return await this.http.json(target.provider, endpoint, { signal });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }
  async create(target: UploadTarget, signal?: AbortSignal) {
    const existing = await this.findTarget(target, signal);
    const marker = target.creationKey
      ? `Archived with Hedwig · transfer ${target.creationKey}`
      : undefined;
    if (existing) {
      // Reconcile a successful server-side create whose response was lost, only for this saved intent.
      if (marker && existing.description === marker)
        return {
          repoId: String(existing.id),
          url: existing.html_url || existing.web_url,
          cloneUrl: existing.clone_url || existing.http_url_to_repo,
        };
      throw new Error(
        "A repository with this name already exists. Choose a new destination name.",
      );
    }
    const p = target.provider;
    const r = await this.http.json(
      p,
      p === "github" ? "/user/repos" : "/projects",
      {
        method: "POST",
        signal,
        body: JSON.stringify(
          p === "github"
            ? {
                name: target.name,
                private: target.visibility === "private",
                auto_init: false,
                description: marker,
              }
            : {
                name: target.name,
                path: target.name,
                visibility: target.visibility,
                initialize_with_readme: false,
                description: marker,
              },
        ),
      },
    );
    return {
      repoId: String(r.id),
      url: r.html_url || r.web_url,
      cloneUrl: r.clone_url || r.http_url_to_repo,
    };
  }
  targetBase(t: UploadTarget) {
    return t.provider === "github"
      ? `/repos/${t.account}/${t.name}`
      : `/projects/${t.repoId}`;
  }
  async defaultBranch(t: UploadTarget, branch: string, signal?: AbortSignal) {
    if (!branch) return;
    await this.http.json(t.provider, this.targetBase(t), {
      method: t.provider === "github" ? "PATCH" : "PUT",
      signal,
      body: JSON.stringify({ default_branch: branch }),
    });
  }
  async release(
    t: UploadTarget,
    r: Release,
    signal?: AbortSignal,
  ): Promise<string> {
    const base = this.targetBase(t);
    const p = t.provider;
    try {
      const existing = await this.http.json(
        p,
        `${base}/releases/${p === "github" ? "tags/" : ""}${encodeURIComponent(r.tag)}`,
        { signal },
      );
      return String(existing.id ?? existing.tag_name);
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 404) throw e;
    }
    const created = await this.http.json(p, `${base}/releases`, {
      method: "POST",
      signal,
      body: JSON.stringify(
        p === "github"
          ? {
              tag_name: r.tag,
              name: r.name,
              body: r.body,
              draft: false,
              prerelease: false,
            }
          : {
              tag_name: r.tag,
              name: r.name,
              description: r.body,
              released_at: r.publishedAt,
            },
      ),
    });
    return String(created.id ?? created.tag_name);
  }
  async uploadAsset(
    t: UploadTarget,
    release: Release,
    asset: Asset,
    file: string,
    signal: AbortSignal,
  ) {
    const size = (await stat(file)).size;
    const name = asset.localName || asset.name;
    if (t.provider === "github") {
      const base = `${this.targetBase(t)}/releases/${t.releaseId}/assets`;
      const existing = (await this.http.pages("github", base, signal)).find(
        (a) => a.name === name,
      );
      if (existing && existing.size === size && existing.state === "uploaded")
        return;
      if (existing)
        await this.http.json(
          "github",
          `${this.targetBase(t)}/releases/assets/${existing.id}`,
          { method: "DELETE", signal },
        );
      const body = fs.createReadStream(file);
      try {
        const res = await this.http.request(
          `https://uploads.github.com${base}?name=${encodeURIComponent(name)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(size),
            },
            body: body as any,
            duplex: "half",
            signal,
          } as RequestInit,
        );
        await this.http.check(res);
        await res.body?.cancel();
      } finally {
        body.destroy();
      }
    } else {
      const version = Buffer.from(release.tag).toString("hex");
      const packageUrl = `${apiBase("gitlab")}${this.targetBase(t)}/packages/generic/hedwig-release/${version}/${encodeURIComponent(name)}`;
      const links = await this.http.pages(
        "gitlab",
        `${this.targetBase(t)}/releases/${encodeURIComponent(release.tag)}/assets/links`,
        signal,
      );
      if (links.some((a) => a.url === packageUrl)) return;
      const head = await this.http.request(packageUrl, {
        method: "HEAD",
        signal,
      });
      const exists =
        head.ok && Number(head.headers.get("content-length")) === size;
      if (!head.ok && head.status !== 404) await this.http.check(head);
      else await head.body?.cancel();
      if (!exists) {
        const body = fs.createReadStream(file);
        try {
          const res = await this.http.request(packageUrl, {
            method: "PUT",
            headers: {
              "Content-Type": "application/octet-stream",
              "Content-Length": String(size),
            },
            body: body as any,
            duplex: "half",
            signal,
          } as RequestInit);
          await this.http.check(res);
          await res.body?.cancel();
        } finally {
          body.destroy();
        }
      }
      await this.http.json(
        "gitlab",
        `${this.targetBase(t)}/releases/${encodeURIComponent(release.tag)}/assets/links`,
        {
          method: "POST",
          signal,
          body: JSON.stringify({ name, url: packageUrl, link_type: "package" }),
        },
      );
    }
  }
}
