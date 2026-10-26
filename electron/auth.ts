import { safeStorage, shell } from "electron";
import path from "node:path";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Account, AuthProgress, Provider, Settings } from "../src/shared";
import { atomicJSON, readJSON } from "./storage";
type Saved = { login: string; encrypted: string };
type Token = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
};
export const CALLBACK = "http://127.0.0.1:43821/oauth/callback";
export class Auth {
  private saved: Partial<Record<Provider, Saved>> = {};
  private busy = false;
  private refresh?: Promise<string>;
  constructor(
    readonly root: string,
    readonly settings: () => Settings,
    readonly progress: (p: AuthProgress) => void,
  ) {}
  async init() {
    this.saved = await readJSON(path.join(this.root, "accounts.json"), {});
  }
  accounts(): Account[] {
    return Object.entries(this.saved).map(([provider, a]) => ({
      provider: provider as Provider,
      login: a!.login,
    }));
  }
  private async save(provider: Provider, login: string, token: Token) {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("Windows credential encryption is unavailable.");
    this.saved[provider] = {
      login,
      encrypted: safeStorage
        .encryptString(JSON.stringify(token))
        .toString("base64"),
    };
    await atomicJSON(path.join(this.root, "accounts.json"), this.saved);
  }
  async disconnect(provider: Provider) {
    if (this.busy) throw new Error("Finish account sign-in first.");
    delete this.saved[provider];
    await atomicJSON(path.join(this.root, "accounts.json"), this.saved);
  }
  async token(provider: Provider): Promise<string | undefined> {
    const saved = this.saved[provider];
    if (!saved) return;
    let token: Token;
    try {
      token = JSON.parse(
        safeStorage.decryptString(Buffer.from(saved.encrypted, "base64")),
      );
    } catch {
      throw new Error(
        "Unable to unlock this account on Windows. Reconnect in Accounts.",
      );
    }
    if (
      provider === "gitlab" &&
      token.expires_at &&
      token.expires_at < Date.now() + 60_000
    ) {
      if (!this.refresh)
        this.refresh = (async () => {
          const next = await this.exchange("https://gitlab.com/oauth/token", {
            grant_type: "refresh_token",
            refresh_token: token.refresh_token!,
            client_id: this.settings().gitlabClientId,
          });
          await this.save(provider, saved.login, this.normalise(next));
          return next.access_token as string;
        })().finally(() => {
          this.refresh = undefined;
        });
      return this.refresh;
    }
    return token.access_token;
  }
  normalise(t: any): Token {
    return {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
    };
  }
  async exchange(url: string, values: Record<string, string>) {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(values),
      signal: AbortSignal.timeout(30_000),
    });
    const data = (await r.json()) as any;
    if (!r.ok || !data.access_token)
      throw new Error(
        "Authorization failed or expired. Reconnect your account.",
      );
    return data;
  }
  async connect(provider: Provider) {
    if (this.busy)
      throw new Error("Another account sign-in is already in progress.");
    this.busy = true;
    try {
      const id =
        provider === "github"
          ? this.settings().githubClientId
          : this.settings().gitlabClientId;
      if (!id)
        throw new Error(
          "Save your OAuth application client ID in Accounts first.",
        );
      const data =
        provider === "github" ? await this.github(id) : await this.gitlab(id);
      const res = await fetch(
        provider === "github"
          ? "https://api.github.com/user"
          : "https://gitlab.com/api/v4/user",
        {
          headers: {
            Authorization: `Bearer ${data.access_token}`,
            "User-Agent": "Hedwig/1.0",
          },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!res.ok)
        throw new Error("Could not load your account after sign-in.");
      const user = (await res.json()) as any;
      await this.save(
        provider,
        provider === "github" ? user.login : user.username,
        this.normalise(data),
      );
      this.progress({ provider, message: "Account connected." });
    } finally {
      this.busy = false;
    }
  }
  async github(id: string) {
    const res = await fetch("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ client_id: id, scope: "repo workflow" }),
      signal: AbortSignal.timeout(30_000),
    });
    const d = (await res.json()) as any;
    if (!res.ok || !d.device_code)
      throw new Error(
        "GitHub device flow is unavailable. Check the client ID and enable Device Flow on the OAuth application.",
      );
    this.progress({
      provider: "github",
      code: d.user_code,
      message: "Enter this code in the GitHub browser window.",
    });
    await shell.openExternal("https://github.com/login/device");
    const expires = Date.now() + d.expires_in * 1000;
    let interval = (d.interval || 5) * 1000;
    while (Date.now() < expires) {
      await delay(interval);
      const r = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: id,
          device_code: d.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const t = (await r.json()) as any;
      if (t.access_token) return t;
      if (t.error === "slow_down") interval += 5000;
      else if (t.error !== "authorization_pending")
        throw new Error("GitHub sign-in was denied or expired. Try again.");
    }
    throw new Error("GitHub sign-in expired. Try again.");
  }
  async gitlab(id: string) {
    const state = randomBytes(32).toString("hex");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const code = await new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        const u = new URL(req.url || "/", CALLBACK);
        if (
          u.pathname !== "/oauth/callback" ||
          u.searchParams.get("state") !== state
        ) {
          res.writeHead(400);
          res.end("Invalid authorization callback.");
          return;
        }
        const value = u.searchParams.get("code");
        res.setHeader("Content-Type", "text/plain");
        res.end(
          value
            ? "Connected. You can return to Hedwig."
            : "Authorization declined. Return to Hedwig.",
        );
        clearTimeout(timer);
        server.close();
        value
          ? resolve(value)
          : reject(new Error("GitLab authorization was declined."));
      });
      const timer = setTimeout(() => {
        server.close();
        reject(new Error("GitLab sign-in expired. Try again."));
      }, 5 * 60_000);
      server.on("error", () => {
        clearTimeout(timer);
        reject(
          new Error(
            "Cannot open the sign-in callback on port 43821. Close other sign-in attempts and retry.",
          ),
        );
      });
      server.listen(43821, "127.0.0.1", () => {
        const url = new URL("https://gitlab.com/oauth/authorize");
        url.search = new URLSearchParams({
          client_id: id,
          redirect_uri: CALLBACK,
          response_type: "code",
          state,
          scope: "api read_repository write_repository",
          code_challenge: challenge,
          code_challenge_method: "S256",
        }).toString();
        this.progress({
          provider: "gitlab",
          message: "Finish signing in in your browser.",
        });
        void shell.openExternal(url.toString()).catch((e) => {
          clearTimeout(timer);
          server.close();
          reject(e);
        });
      });
    });
    return this.exchange("https://gitlab.com/oauth/token", {
      client_id: id,
      code,
      grant_type: "authorization_code",
      redirect_uri: CALLBACK,
      code_verifier: verifier,
    });
  }
}
