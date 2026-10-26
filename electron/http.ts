import type { Provider } from "../src/shared";
export type TokenSource = (provider: Provider) => Promise<string | undefined>;
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export const apiBase = (provider: Provider) =>
  provider === "github"
    ? "https://api.github.com"
    : "https://gitlab.com/api/v4";
export function credentialProvider(url: string): Provider | undefined {
  const u = new URL(url);
  if (u.protocol !== "https:") return;
  if (
    ["github.com", "api.github.com", "uploads.github.com"].includes(u.hostname)
  )
    return "github";
  if (u.hostname === "gitlab.com") return "gitlab";
}
export class Http {
  constructor(
    readonly token: TokenSource,
    readonly fetcher: typeof fetch = fetch,
  ) {}
  async request(
    url: string,
    init: RequestInit = {},
    accept = "application/json",
  ): Promise<Response> {
    let current = url;
    const originalProvider = credentialProvider(url);
    for (let redirect = 0; redirect < 8; redirect++) {
      const u = new URL(current);
      if (u.protocol !== "https:" || u.username || u.password)
        throw new Error(
          "Asset links must use HTTPS without embedded credentials.",
        );
      const headers = new Headers(init.headers);
      headers.set("User-Agent", "Hedwig/1.0");
      headers.set("Accept", accept);
      headers.delete("Authorization");
      headers.delete("PRIVATE-TOKEN");
      const provider = credentialProvider(current);
      if (provider && provider === originalProvider) {
        const token = await this.token(provider);
        if (token) headers.set("Authorization", `Bearer ${token}`);
      }
      if (u.hostname === "api.github.com")
        headers.set("X-GitHub-Api-Version", "2022-11-28");
      const response = await this.fetcher(current, {
        ...init,
        headers,
        redirect: "manual",
        signal: init.signal ?? AbortSignal.timeout(120_000),
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location)
          throw new Error("Server returned a redirect without a location.");
        if (init.method && init.method !== "GET" && init.method !== "HEAD")
          throw new Error(
            "Unexpected redirect during upload. Retry using the canonical destination.",
          );
        current = new URL(location, current).toString();
        continue;
      }
      return response;
    }
    throw new Error("Too many download redirects.");
  }
  async check(response: Response) {
    if (response.ok) return;
    const status = response.status;
    let reason = `Service returned HTTP ${status}.`;
    if (status === 401)
      reason =
        "Your account authorization expired. Reconnect in Accounts and retry.";
    else if (status === 403 || status === 429) {
      const after = response.headers.get("retry-after");
      const reset = response.headers.get("x-ratelimit-reset");
      reason = `Access denied or service rate limit reached.${after ? ` Retry after ${after} seconds.` : reset ? ` Limit resets at ${new Date(Number(reset) * 1000).toLocaleString()}.` : " Check account permissions and retry later."}`;
    } else if (status === 404)
      reason =
        "Repository or resource not found. For private repositories, connect an account with access.";
    else if (status === 409 || status === 422 || status === 400)
      reason = `The service rejected this operation (HTTP ${status}). Check the repository name, permissions, existing files, and service limits.`;
    await response.body?.cancel();
    throw new HttpError(status, reason);
  }
  async json<T = any>(
    provider: Provider,
    endpoint: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.request(`${apiBase(provider)}${endpoint}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
    await this.check(response);
    if (response.status === 204) return undefined as T;
    return response.json();
  }
  async pages<T = any>(
    provider: Provider,
    endpoint: string,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; ; page++) {
      const items = await this.json<T[]>(
        provider,
        `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
        { signal },
      );
      if (!Array.isArray(items))
        throw new Error("Unexpected pagination response.");
      result.push(...items);
      if (items.length < 100) return result;
    }
  }
}
