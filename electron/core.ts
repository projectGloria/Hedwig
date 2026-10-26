import path from "node:path";
import { createHash } from "node:crypto";
import type { RepoRef } from "../src/shared";

export function parseRepo(input: string): RepoRef {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    throw new Error(
      "Paste a full https://github.com or https://gitlab.com repository URL.",
    );
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !["github.com", "gitlab.com"].includes(u.hostname)
  )
    throw new Error(
      "Only HTTPS repositories on github.com and gitlab.com are supported.",
    );
  let parts = u.pathname
    .split("/")
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
  if (u.hostname === "github.com") parts = parts.slice(0, 2);
  else {
    const marker = parts.indexOf("-");
    if (marker >= 0) parts = parts.slice(0, marker);
  }
  if (
    parts.length < 2 ||
    parts.some((p) => !/^[\w.-]+$/.test(p) || p === "." || p === "..")
  )
    throw new Error("The URL must include a repository owner and name.");
  const name = parts.pop()!.replace(/\.git$/, "");
  if (!name) throw new Error("Missing repository name.");
  const owner = parts.join("/");
  const fullName = `${owner}/${name}`;
  return {
    provider: u.hostname === "github.com" ? "github" : "gitlab",
    owner,
    name,
    fullName,
    url: `https://${u.hostname}/${fullName}`,
    cloneUrl: `https://${u.hostname}/${fullName}.git`,
  };
}
export function safeName(name: string): string {
  let clean = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 140)
    .replace(/[. ]+$/g, "");
  if (
    !clean ||
    /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(clean) ||
    clean === "." ||
    clean === ".."
  )
    clean = `_${clean || "file"}`;
  return clean;
}
export function assetNames(assets: { id: string; name: string }[]): string[] {
  const used = new Set<string>();
  const variants = (name: string) => [
    name.toLowerCase(),
    `${name.toLowerCase()}.partial`,
    `${name.toLowerCase()}.partial.json`,
  ];
  return assets.map((a) => {
    let name = safeName(a.name);
    let n = 1;
    while (variants(name).some((v) => used.has(v))) {
      const ext = path.extname(safeName(a.name));
      name = `${path.basename(safeName(a.name), ext)}-${n++}${ext}`;
    }
    variants(name).forEach((v) => used.add(v));
    return name;
  });
}
export function within(root: string, ...parts: string[]): string {
  const result = path.resolve(root, ...parts);
  const rel = path.relative(path.resolve(root), result);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    throw new Error("Unsafe file path.");
  return result;
}
export const keyFor = (text: string) =>
  createHash("sha256").update(text).digest("hex").slice(0, 24);
export function publicError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg
    .replace(/https?:\/\/[^\s]+/g, (raw) => {
      try {
        const u = new URL(raw);
        u.username = "";
        u.password = "";
        u.search = "";
        return u.toString();
      } catch {
        return "[URL]";
      }
    })
    .replace(
      /(?:gh[pousr]_[A-Za-z0-9_]+|glpat-[\w-]+|Bearer\s+\S+)/gi,
      "[redacted]",
    )
    .slice(0, 1800);
}
