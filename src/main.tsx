import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownToLine,
  ArrowUpRight,
  ArrowUpFromLine,
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  ExternalLink,
  Folder,
  FolderOpen,
  Github,
  GitBranch,
  GitFork,
  HardDrive,
  History,
  Layers,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Package,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Star,
  Terminal,
  X,
  AlertCircle,
  LogOut,
} from "lucide-react";
import type {
  AuthProgress,
  Job,
  Provider,
  Repository,
  Settings,
  Snapshot,
} from "./shared";
import "./style.css";
const api = window.hedwig;
const label = (p: Provider) => (p === "github" ? "GitHub" : "GitLab");
const bytes = (n?: number) =>
  n === undefined
    ? "Size unknown"
    : n < 1024
      ? `${n} B`
      : n < 1024 ** 2
        ? `${(n / 1024).toFixed(1)} KB`
        : n < 1024 ** 3
          ? `${(n / 1024 ** 2).toFixed(1)} MB`
          : `${(n / 1024 ** 3).toFixed(2)} GB`;
function Mark({ small = false }: { small?: boolean }) {
  return (
    <div className={`mark ${small ? "small" : ""}`}>
      <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <path
          d="M6 9L12 13L20 10L28 13L34 9V24C34 30 27 35 20 36C13 35 6 30 6 24V9Z"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M10 18L18 20L14 25L10 18ZM30 18L22 20L26 25L30 18Z"
          fill="currentColor"
        />
        <path d="M18 28L20 31L22 28" stroke="currentColor" strokeWidth="2" />
      </svg>
    </div>
  );
}
function App() {
  const [data, setData] = useState<Snapshot>();
  const [page, setPage] = useState("download");
  const [url, setUrl] = useState("");
  const [destination, setDestination] = useState("");
  const [repo, setRepo] = useState<Repository>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [modal, setModal] = useState<"accounts" | "settings" | null>(null);
  const [upload, setUpload] = useState<{ job: Job; provider: Provider }>();
  const [menu, setMenu] = useState<string>();
  const [auth, setAuth] = useState<AuthProgress>();
  const [settings, setSettings] = useState<Settings>();
  const [connecting, setConnecting] = useState(false);
  useEffect(() => {
    if (!api) {
      setError(
        "Open Hedwig in the desktop app to access downloads and account connections.",
      );
      return;
    }
    api
      .snapshot()
      .then((s) => {
        setData(s);
        setDestination(s.settings.destination);
        setSettings(s.settings);
      })
      .catch((e) => setError(e.message));
    const a = api.onChange((s) => setData(s));
    const b = api.onAuth(setAuth);
    return () => {
      a();
      b();
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);
  async function action(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(
        e.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
      );
    }
  }
  async function inspect() {
    setBusy(true);
    setRepo(undefined);
    await action(async () => setRepo(await api.inspect(url)));
    setBusy(false);
  }
  async function download() {
    setBusy(true);
    await action(async () => {
      await api.download(url, destination);
      setNotice("Download added to your transfer queue.");
      setPage("transfers");
    });
    setBusy(false);
  }
  const openSettings = (kind: "accounts" | "settings") => {
    setSettings(data?.settings);
    setModal(kind);
    setMenu(undefined);
  };
  const jobs = data?.jobs || [];
  const active = jobs.filter((j) => ["queued", "running"].includes(j.status));
  const archives = jobs.filter(
    (j) => j.kind === "download" && j.status === "completed",
  );
  const choose = async () => {
    const value = await api.chooseFolder();
    if (value) setDestination(value);
  };
  const jobMenu = (j: Job) => (
    <div className="dropdown" role="menu">
      <button
        disabled={j.kind !== "download" || j.status !== "completed"}
        onClick={() => {
          setUpload({ job: j, provider: "github" });
          setMenu(undefined);
        }}
      >
        <Github size={16} /> Upload to your GitHub
      </button>
      <button
        disabled={j.kind !== "download" || j.status !== "completed"}
        onClick={() => {
          setUpload({ job: j, provider: "gitlab" });
          setMenu(undefined);
        }}
      >
        <GitFork size={16} /> Upload to your GitLab
      </button>
      <hr />
      <button onClick={() => action(() => api.openFolder(j.id))}>
        <FolderOpen size={16} /> Open download folder
      </button>
      <button
        onClick={() =>
          action(async () => {
            await api.copyUrl(j.id);
            setNotice("Source URL copied.");
            setMenu(undefined);
          })
        }
      >
        <Copy size={16} /> Copy source URL
      </button>
      {["failed", "cancelled"].includes(j.status) && (
        <button
          onClick={() =>
            action(async () => {
              await api.retry(j.id);
              setMenu(undefined);
            })
          }
        >
          <RefreshCw size={16} /> Retry transfer
        </button>
      )}
      <hr />
      <button onClick={() => openSettings("accounts")}>
        <ShieldCheck size={16} /> Accounts
      </button>
      <button onClick={() => openSettings("settings")}>
        <Settings2 size={16} /> Settings
      </button>
    </div>
  );
  function JobCard({ job: j }: { job: Job }) {
    const running = j.status === "running" || j.status === "queued";
    return (
      <article className="job-card">
        <div className={`job-icon ${j.status}`}>
          <>
            {j.status === "completed" ? (
              <Check size={21} />
            ) : j.status === "failed" ? (
              <AlertCircle size={21} />
            ) : j.kind === "upload" ? (
              <ArrowUpFromLine size={21} />
            ) : (
              <ArrowDownToLine size={21} />
            )}
          </>
        </div>
        <div className="job-body">
          <div className="job-title">
            <strong>
              {j.kind === "upload"
                ? `${j.target?.account}/${j.target?.name}`
                : j.repo.fullName}
            </strong>
            <span className={`status ${j.status}`}>{j.status}</span>
          </div>
          <p>
            {j.kind === "upload" ? `To ${label(j.target!.provider)} · ` : ""}
            {j.stage}
            {j.bytes !== undefined
              ? ` · ${bytes(j.bytes)}${j.total ? ` / ${bytes(j.total)}` : ""}`
              : ""}
          </p>
          {running && (
            <div className={`progress ${!j.total ? "indeterminate" : ""}`}>
              <div
                style={{
                  width: j.total
                    ? `${Math.min(100, ((j.bytes || 0) / j.total) * 100)}%`
                    : "35%",
                }}
              />
            </div>
          )}
          {j.error && <p className="job-error">{j.error}</p>}
          <div className="job-meta">
            <span>{j.repo.release?.tag || "No release"}</span>
            <span>·</span>
            <span>{new Date(j.createdAt).toLocaleDateString()}</span>
            {j.target?.url && (
              <button
                className="text-button"
                onClick={() => action(() => api.openExternal(j.target!.url!))}
              >
                View destination <ArrowUpRight size={12} />
              </button>
            )}
          </div>
        </div>
        <div className="job-actions">
          {running ? (
            <button
              className="icon-button"
              title="Cancel transfer"
              onClick={() => action(() => api.cancel(j.id))}
            >
              <X size={17} />
            </button>
          ) : ["failed", "cancelled"].includes(j.status) ? (
            <button
              className="icon-button"
              title="Retry transfer"
              onClick={() => action(() => api.retry(j.id))}
            >
              <RefreshCw size={17} />
            </button>
          ) : (
            <button
              className="icon-button"
              title="Open folder"
              onClick={() => action(() => api.openFolder(j.id))}
            >
              <FolderOpen size={17} />
            </button>
          )}
          <button
            className="icon-button"
            aria-label={`Options for ${j.repo.fullName}`}
            onClick={() => setMenu(menu === j.id ? undefined : j.id)}
          >
            <MoreHorizontal size={19} />
          </button>
          {menu === j.id && jobMenu(j)}
        </div>
      </article>
    );
  }
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" onClick={() => setPage("download")}>
          <Mark />
          <span>
            hedwig<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          <button
            className={page === "download" ? "selected" : ""}
            onClick={() => setPage("download")}
          >
            <ArrowDownToLine size={18} /> New download{" "}
            <Plus size={15} className="nav-tail" />
          </button>
          <button
            className={page === "transfers" ? "selected" : ""}
            onClick={() => setPage("transfers")}
          >
            <Layers size={18} /> Transfers{" "}
            <span className="nav-count">{active.length}</span>
          </button>
          <button
            className={page === "library" ? "selected" : ""}
            onClick={() => setPage("library")}
          >
            <Archive size={18} /> My archives{" "}
            <span className="nav-count">{archives.length}</span>
          </button>
          <button
            className={page === "history" ? "selected" : ""}
            onClick={() => setPage("history")}
          >
            <History size={18} /> History
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <ShieldCheck size={19} />
            <strong>Your code. Your copy.</strong>
            <p>
              Stored on your device.
              <br />
              Ready when you need it.
            </p>
          </div>
          <button onClick={() => openSettings("accounts")}>
            <GitFork size={17} /> Connected accounts{" "}
            <span className="nav-count">{data?.accounts.length || 0}</span>
          </button>
          <button onClick={() => openSettings("settings")}>
            <Settings2 size={17} /> Settings
          </button>
          <div className="version">
            <span className="green-dot" /> Local workspace{" "}
            <span>v{data?.version || "1.0.0"}</span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>Workspace</span>
          <ChevronRight size={14} />
          <strong>
            {page === "download"
              ? "New download"
              : page === "library"
                ? "My archives"
                : page === "history"
                  ? "History"
                  : "Transfers"}
          </strong>
          <button
            onClick={() => openSettings("accounts")}
            className="account-button"
          >
            <span
              className={`connection-dot ${data?.accounts.length ? "connected" : ""}`}
            />
            {data?.accounts.length
              ? `${data.accounts.length} account${data.accounts.length > 1 ? "s" : ""} connected`
              : "Connect an account"}
            <ChevronDown size={14} />
          </button>
        </header>
        <div className="content">
          {error && (
            <div className="banner error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              <Check size={18} />
              <span>{notice}</span>
            </div>
          )}
          {page === "download" ? (
            <>
              <div className="eyebrow">
                <span /> A HOME FOR YOUR REPOSITORIES
              </div>
              <h1>
                Keep the code.
                <br />
                <span>Keep the release.</span>
              </h1>
              <p className="intro">
                A complete copy of the repositories you care about.
                <br />
                All the history, every branch, and the latest release — in one
                place.
              </p>
              <section className="download-panel">
                <div className="panel-title">
                  <div className="panel-symbol">
                    <ArrowDownToLine size={20} />
                  </div>
                  <div>
                    <h2>Download a repository</h2>
                    <p>Start with a GitHub or GitLab repository URL.</p>
                  </div>
                  <span className="pill">FULL ARCHIVE</span>
                </div>
                <label htmlFor="repo-url">Repository URL</label>
                <div className="url-row">
                  <div className="input-icon">
                    <Link2 size={18} />
                    <input
                      id="repo-url"
                      value={url}
                      onChange={(e) => {
                        setUrl(e.target.value);
                        setRepo(undefined);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && url && !busy) void inspect();
                      }}
                      placeholder="https://github.com/owner/repository"
                      spellCheck={false}
                    />
                  </div>
                  <button
                    className="secondary"
                    disabled={!url.trim() || busy}
                    onClick={inspect}
                  >
                    {busy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}{" "}
                    Preview
                  </button>
                </div>
                <div className="field-hint">
                  <Github size={13} /> GitHub <span>·</span>
                  <GitFork size={13} /> GitLab <span>·</span> Repository and
                  release URLs supported
                </div>
                <label htmlFor="destination">Save to</label>
                <div className="destination-row">
                  <Folder size={17} />
                  <input
                    id="destination"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    placeholder="Choose a download folder"
                  />
                  <button onClick={() => action(choose)}>Browse</button>
                </div>
                <div className="includes">
                  <span>
                    <Check size={14} /> Full Git history
                  </span>
                  <span>
                    <Check size={14} /> Latest release assets
                  </span>
                  <span>
                    <Check size={14} /> LFS & submodules
                  </span>
                </div>
                {repo && (
                  <div className="repo-preview">
                    <div className="repo-heading">
                      <Github size={19} />
                      <strong>{repo.fullName}</strong>
                      <span className="subtle-tag">
                        {repo.private ? "Private" : "Public"}
                      </span>
                      <span className="stars">
                        <Star size={13} />
                        {repo.stars.toLocaleString()}
                      </span>
                    </div>
                    <p>{repo.description || "No description provided."}</p>
                    <div className="release-line">
                      <Package size={15} />
                      <strong>
                        {repo.release?.name || "No release available"}
                      </strong>
                      {repo.release && (
                        <span>{repo.release.assets.length} assets</span>
                      )}
                      <span className="branch">
                        <GitBranch size={14} />
                        {repo.defaultBranch || "Empty repository"}
                      </span>
                    </div>
                    {repo.release && (
                      <div className="asset-list">
                        {repo.release.assets.map((a) => (
                          <div key={a.id}>
                            <Package size={13} />
                            <span>{a.name}</span>
                            <small>{bytes(a.size)}</small>
                          </div>
                        ))}
                        {repo.release.assets.length === 0 && (
                          <p>
                            This release has no attached files. Its notes and
                            Git tag will be archived.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="download-footer">
                  <span>
                    <ShieldCheck size={15} /> Downloaded directly to your device
                  </span>
                  <button
                    className="primary"
                    disabled={!url.trim() || !destination || busy}
                    onClick={download}
                  >
                    <ArrowDownToLine size={17} />
                    {busy ? "Please wait…" : "Download repository"}
                  </button>
                </div>
              </section>
              <div className="feature-grid">
                <div>
                  <div className="feature-icon">
                    <GitBranch size={20} />
                  </div>
                  <h3>The whole story</h3>
                  <p>
                    Every branch, tag, and commit.
                    <br />
                    More than a source code ZIP.
                  </p>
                </div>
                <div>
                  <div className="feature-icon">
                    <Package size={20} />
                  </div>
                  <h3>Releases included</h3>
                  <p>
                    Latest release files and notes,
                    <br />
                    right beside your source code.
                  </p>
                </div>
                <div>
                  <div className="feature-icon">
                    <ArrowUpFromLine size={20} />
                  </div>
                  <h3>Make it yours</h3>
                  <p>
                    Upload your archive to your
                    <br />
                    own GitHub or GitLab account.
                  </p>
                </div>
              </div>
              {jobs.length > 0 && (
                <section className="recent">
                  <div className="section-heading">
                    <h2>Recent activity</h2>
                    <button
                      className="text-button"
                      onClick={() => setPage("history")}
                    >
                      View all <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {jobs.slice(0, 2).map((j) => (
                    <JobCard key={j.id} job={j} />
                  ))}
                </section>
              )}
            </>
          ) : (
            <>
              <div className="page-heading">
                <div className="eyebrow">YOUR WORKSPACE</div>
                <h1>
                  {page === "library"
                    ? "My archives"
                    : page === "history"
                      ? "Transfer history"
                      : "Transfers"}
                </h1>
                <p className="intro">
                  {page === "library"
                    ? "Complete local copies, ready to explore or upload."
                    : page === "history"
                      ? "Every download and upload, with its progress saved."
                      : "Follow your downloads and uploads from start to finish."}
                </p>
              </div>
              <div className="section-heading">
                <span className="subtle-tag">
                  {page === "library"
                    ? archives.length
                    : page === "transfers"
                      ? active.length
                      : jobs.length}{" "}
                  {page === "library" ? "archives" : "transfers"}
                </span>
                <button
                  className="secondary"
                  onClick={() => setPage("download")}
                >
                  <Plus size={15} /> New download
                </button>
              </div>
              {(page === "library"
                ? archives
                : page === "transfers"
                  ? jobs.filter((j) => j.status !== "completed")
                  : jobs
              ).map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
              {(page === "library"
                ? archives.length === 0
                : page === "transfers"
                  ? jobs.filter((j) => j.status !== "completed").length === 0
                  : jobs.length === 0) && (
                <div className="empty-state">
                  <div>
                    <Archive size={32} />
                  </div>
                  <h2>
                    {page === "transfers"
                      ? "All clear here"
                      : "Your next archive starts here"}
                  </h2>
                  <p>
                    Paste a repository URL to keep a complete copy on your
                    device.
                  </p>
                  <button
                    className="primary"
                    onClick={() => setPage("download")}
                  >
                    <Plus size={16} /> New download
                  </button>
                </div>
              )}
            </>
          )}
          <footer>
            <Mark small />
            <span>Built for keeping things.</span>
            <span className="footer-right">
              GitHub & GitLab <span> / </span> Windows
            </span>
          </footer>
        </div>
      </main>
      {modal && settings && (
        <div
          className="modal-backdrop"
          onClick={() => !connecting && setModal(null)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "accounts" ? "Connected accounts" : "Settings"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <h2>
                {modal === "accounts" ? "Connected accounts" : "Settings"}
              </h2>
              <button
                className="icon-button"
                disabled={connecting}
                onClick={() => setModal(null)}
                aria-label="Close dialog"
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <div className="banner error" role="alert">
                {error}
              </div>
            )}
            {modal === "settings" ? (
              <>
                <p>Choose where new archives are saved.</p>
                <label>Default download folder</label>
                <div className="destination-row">
                  <input
                    value={settings.destination}
                    onChange={(e) =>
                      setSettings({ ...settings, destination: e.target.value })
                    }
                  />
                  <button
                    onClick={() =>
                      action(async () => {
                        const value = await api.chooseFolder();
                        if (value)
                          setSettings({ ...settings, destination: value });
                      })
                    }
                  >
                    Browse
                  </button>
                </div>
                <div className="info-box">
                  <HardDrive size={18} />
                  <p>
                    Archives include Git history, LFS files, submodule
                    repositories, and the latest release assets. Downloads
                    remain on your device when you close the app.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() =>
                    action(async () => {
                      await api.saveSettings(settings);
                      setDestination(settings.destination);
                      setModal(null);
                      setNotice("Settings saved.");
                    })
                  }
                >
                  Save settings
                </button>
              </>
            ) : (
              <>
                <p>
                  Connect to download private repositories and upload your
                  archives. Public downloads work without signing in.
                </p>
                {(["github", "gitlab"] as Provider[]).map((p) => {
                  const account = data?.accounts.find((a) => a.provider === p);
                  const field =
                    p === "github" ? "githubClientId" : "gitlabClientId";
                  return (
                    <div className="account-card" key={p}>
                      <div className="section-heading">
                        <h3>
                          {p === "github" ? (
                            <Github size={19} />
                          ) : (
                            <GitFork size={19} />
                          )}{" "}
                          {label(p)}
                        </h3>
                        {account && (
                          <span className="connected-label">
                            <Check size={13} />
                            {account.login}
                          </span>
                        )}
                      </div>
                      <label htmlFor={`${p}-id`}>
                        OAuth application client ID
                      </label>
                      <input
                        id={`${p}-id`}
                        className="plain-input"
                        disabled={connecting}
                        placeholder={`Your ${label(p)} public client ID`}
                        value={settings[field]}
                        onChange={(e) =>
                          setSettings({ ...settings, [field]: e.target.value })
                        }
                      />
                      <details>
                        <summary>
                          One-time app registration <ChevronDown size={13} />
                        </summary>
                        {p === "github" ? (
                          <p>
                            Create an OAuth app with homepage{" "}
                            <code>https://github.com</code> and callback{" "}
                            <code>http://127.0.0.1:43821/oauth/callback</code>.
                            Enable <strong>Device Flow</strong>. Copy its client
                            ID above. Sign-in requests repo and workflow access
                            to copy repository contents.
                          </p>
                        ) : (
                          <p>
                            Create a <strong>non-confidential</strong> OAuth
                            application with callback{" "}
                            <code>http://127.0.0.1:43821/oauth/callback</code>{" "}
                            and scopes{" "}
                            <code>api read_repository write_repository</code>.
                            Copy its application ID above.
                          </p>
                        )}
                        <button
                          className="text-button"
                          onClick={() =>
                            action(() =>
                              api.openExternal(
                                p === "github"
                                  ? "https://github.com/settings/applications/new"
                                  : "https://gitlab.com/-/user_settings/applications",
                              ),
                            )
                          }
                        >
                          Open application settings <ExternalLink size={13} />
                        </button>
                      </details>
                      <div className="account-controls">
                        <button
                          className="secondary"
                          disabled={connecting || !settings[field].trim()}
                          onClick={() =>
                            action(async () => {
                              setConnecting(true);
                              setAuth(undefined);
                              try {
                                await api.saveSettings(settings);
                                await api.connect(p);
                              } finally {
                                setConnecting(false);
                              }
                            })
                          }
                        >
                          {connecting && auth?.provider === p ? (
                            <LoaderCircle size={15} className="spin" />
                          ) : (
                            <ArrowUpRight size={15} />
                          )}{" "}
                          {account ? "Reconnect" : `Sign in with ${label(p)}`}
                        </button>
                        {account && (
                          <button
                            className="text-button"
                            disabled={connecting}
                            onClick={() => action(() => api.disconnect(p))}
                          >
                            <LogOut size={14} /> Disconnect
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {auth && (
                  <div className="auth-progress" role="status">
                    <p>{auth.message}</p>
                    {auth.code && (
                      <strong className="device-code">{auth.code}</strong>
                    )}
                  </div>
                )}
                <div className="field-hint">
                  <ShieldCheck size={15} /> Tokens are encrypted by Windows.
                  Client secrets are never needed.
                </div>
              </>
            )}
          </section>
        </div>
      )}
      {upload && (
        <UploadModal
          error={error}
          job={upload.job}
          provider={upload.provider}
          connected={
            !!data?.accounts.find((a) => a.provider === upload.provider)
          }
          close={() => setUpload(undefined)}
          connect={() => {
            setUpload(undefined);
            openSettings("accounts");
          }}
          submit={(name, visibility) =>
            action(async () => {
              await api.upload(
                upload.job.id,
                upload.provider,
                name,
                visibility,
              );
              setUpload(undefined);
              setPage("transfers");
            })
          }
        />
      )}
    </div>
  );
}
function UploadModal({
  error,
  job,
  provider,
  connected,
  close,
  connect,
  submit,
}: {
  error: string;
  job: Job;
  provider: Provider;
  connected: boolean;
  close: () => void;
  connect: () => void;
  submit: (name: string, visibility: "private" | "public") => Promise<void>;
}) {
  const [name, setName] = useState(job.repo.name);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <section
        className="modal compact"
        role="dialog"
        aria-modal="true"
        aria-label="Upload repository"
      >
        <div className="modal-heading">
          <h2>Upload to {label(provider)}</h2>
          <button
            className="icon-button"
            disabled={busy}
            onClick={close}
            aria-label="Close upload"
          >
            <X size={19} />
          </button>
        </div>
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        <p>
          Create a repository in your account with all branches, tags, LFS
          objects, and the downloaded release.
        </p>
        <label htmlFor="upload-name">New repository name</label>
        <input
          id="upload-name"
          className="plain-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label htmlFor="visibility">Visibility</label>
        <select
          id="visibility"
          className="plain-input"
          value={visibility}
          onChange={(e) =>
            setVisibility(e.target.value as "private" | "public")
          }
        >
          <option value="private">
            Private — only people you grant access
          </option>
          <option value="public">Public — visible to everyone</option>
        </select>
        <div className="info-box">
          <GitBranch size={19} />
          <p>
            Source: <strong>{job.repo.fullName}</strong>
            <br />
            Submodule links retain their original destinations. Existing
            repository names cannot be overwritten.
          </p>
        </div>
        {connected ? (
          <button
            className="primary"
            disabled={busy || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)}
            onClick={async () => {
              setBusy(true);
              await submit(name, visibility);
              setBusy(false);
            }}
          >
            <ArrowUpFromLine size={16} />
            {busy ? "Preparing…" : "Create repository & upload"}
          </button>
        ) : (
          <button className="primary" onClick={connect}>
            Connect {label(provider)} first <ArrowUpRight size={15} />
          </button>
        )}
      </section>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
