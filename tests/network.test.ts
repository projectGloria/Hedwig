import { describe, it, expect, vi } from "vitest";
import { Http, HttpError } from "../electron/http";
import { Providers } from "../electron/providers";
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "Content-Type": "application/json" },
  });
describe("provider transport", () => {
  it("strips authorization across asset redirects", async () => {
    const calls: Headers[] = [];
    const fetcher = vi.fn(async (_url: any, init: any) => {
      calls.push(new Headers(init.headers));
      return calls.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://cdn.example.org/a" },
          })
        : new Response("asset");
    });
    const http = new Http(async () => "private-token", fetcher as any);
    await http.request("https://api.github.com/repos/a/b/releases/assets/1");
    expect(calls[0].get("Authorization")).toBe("Bearer private-token");
    expect(calls[1].get("Authorization")).toBeNull();
  });
  it("does not add another provider token on a cross-provider redirect", async () => {
    const calls: Headers[] = [];
    const http = new Http(
      async (p) => `${p}-secret`,
      vi.fn(async (_u, init) => {
        calls.push(new Headers(init?.headers));
        return calls.length === 1
          ? new Response(null, {
              status: 302,
              headers: { location: "https://gitlab.com/file" },
            })
          : new Response("file");
      }) as any,
    );
    await http.request("https://github.com/file");
    expect(calls[1].has("Authorization")).toBe(false);
  });
  it("paginates beyond the first hundred assets", async () => {
    const fetcher = vi.fn(async (url: any) =>
      json(
        String(url).includes("page=2")
          ? [{ id: 101 }]
          : Array.from({ length: 100 }, (_, id) => ({ id })),
      ),
    );
    const http = new Http(async () => undefined, fetcher as any);
    expect(await http.pages("github", "/assets")).toHaveLength(101);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("reports authentication expiry and rate limits", async () => {
    const http = new Http(async () => undefined);
    await expect(
      http.check(new Response(null, { status: 401 })),
    ).rejects.toThrow("Reconnect");
    await expect(
      http.check(
        new Response(null, { status: 429, headers: { "retry-after": "30" } }),
      ),
    ).rejects.toThrow("30 seconds");
  });
  it("treats only release 404 as no release", async () => {
    const http = new Http(
      async () => undefined,
      vi.fn(async (url: any) =>
        String(url).endsWith("/latest")
          ? json({}, 404)
          : json({ id: 1, default_branch: "main", private: false }),
      ) as any,
    );
    const repo = await new Providers(http).inspect("https://github.com/a/b");
    expect(repo.release).toBeNull();
    expect(repo.defaultBranch).toBe("main");
  });
  it("rejects an existing destination without creating or changing it", async () => {
    const fetcher = vi.fn(async () => json({ id: 99 }));
    const providers = new Providers(
      new Http(async () => "secret", fetcher as any),
    );
    await expect(
      providers.create({
        provider: "github",
        name: "existing",
        visibility: "private",
        account: "owner",
        stages: [],
      }),
    ).rejects.toThrow("already exists");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
