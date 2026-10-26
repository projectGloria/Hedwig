export type Provider = "github" | "gitlab";
export type RepoRef = {
  provider: Provider;
  owner: string;
  name: string;
  fullName: string;
  url: string;
  cloneUrl: string;
};
export type Asset = {
  id: string;
  name: string;
  url: string;
  size?: number;
  digest?: string;
  localName?: string;
};
export type Release = {
  id: string;
  tag: string;
  name: string;
  body: string;
  publishedAt: string;
  assets: Asset[];
};
export type Repository = RepoRef & {
  id: string;
  description: string;
  defaultBranch: string;
  private: boolean;
  stars: number;
  release: Release | null;
};
export type Account = { provider: Provider; login: string };
export type Settings = {
  destination: string;
  githubClientId: string;
  gitlabClientId: string;
};
export type UploadTarget = {
  provider: Provider;
  name: string;
  visibility: "private" | "public";
  account: string;
  repoId?: string;
  url?: string;
  cloneUrl?: string;
  stages: string[];
  releaseId?: string;
  creationKey?: string;
};
export type Job = {
  id: string;
  kind: "download" | "upload";
  sourceJobId?: string;
  repo: Repository;
  folder: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  createdAt: string;
  updatedAt: string;
  bytes?: number;
  total?: number;
  error?: string;
  target?: UploadTarget;
  completedAssets: string[];
};
export type Snapshot = {
  jobs: Job[];
  accounts: Account[];
  settings: Settings;
  version: string;
};
export type AuthProgress = {
  provider: Provider;
  message: string;
  code?: string;
};
export type API = {
  snapshot(): Promise<Snapshot>;
  inspect(url: string): Promise<Repository>;
  chooseFolder(): Promise<string | null>;
  download(url: string, destination: string): Promise<string>;
  upload(
    jobId: string,
    provider: Provider,
    name: string,
    visibility: "private" | "public",
  ): Promise<string>;
  cancel(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
  connect(provider: Provider): Promise<void>;
  disconnect(provider: Provider): Promise<void>;
  openFolder(id: string): Promise<void>;
  copyUrl(id: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onChange(callback: (snapshot: Snapshot) => void): () => void;
  onAuth(callback: (progress: AuthProgress) => void): () => void;
};
declare global {
  interface Window {
    hedwig: API;
  }
}
