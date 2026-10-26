import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
} from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import { Store } from "./storage";
import { Auth } from "./auth";
import { Http } from "./http";
import { Providers } from "./providers";
import { Git } from "./git";
import { Jobs } from "./jobs";
import { publicError } from "./core";
import type { Snapshot } from "../src/shared";
if (process.env.HEDWIG_TEST_USER_DATA)
  app.setPath("userData", process.env.HEDWIG_TEST_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
let window: BrowserWindow | null = null;
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
app
  .whenReady()
  .then(async () => {
    const root = app.getPath("userData");
    const store = new Store(
      root,
      path.join(app.getPath("downloads"), "Hedwig"),
    );
    await store.init();
    const emit = () => {
      if (window && !window.isDestroyed())
        window.webContents.send("changed", snapshot());
    };
    const auth = new Auth(
      root,
      () => store.settings,
      (progress) => {
        if (window && !window.isDestroyed())
          window.webContents.send("auth", progress);
      },
    );
    await auth.init();
    const providers = new Providers(new Http((p) => auth.token(p)));
    const emptyHooks = path.join(root, "empty-hooks");
    await fs.mkdir(emptyHooks, { recursive: true });
    const binary = app.isPackaged
      ? path.join(process.resourcesPath, "git", "cmd", "git.exe")
      : "git";
    const git = new Git({
      binary,
      helper: path.join(__dirname, "credential-helper.cjs"),
      runtime: process.execPath,
      emptyHooks,
      token: (p) => auth.token(p),
    });
    const jobs = new Jobs(store, providers, git, emit);
    app.on("before-quit", () => jobs.stopAll());
    const snapshot = (): Snapshot => ({
      jobs: store.jobs,
      accounts: auth.accounts(),
      settings: store.settings,
      version: app.getVersion(),
    });
    const provider = z.enum(["github", "gitlab"]);
    const id = z.string().uuid();
    const text = z.string().trim().min(1).max(2048);
    const folder = z
      .string()
      .min(1)
      .max(1000)
      .refine(
        (v) => path.isAbsolute(v),
        "Select an absolute destination folder.",
      );
    function handle<T>(
      channel: string,
      schema: z.ZodType<T>,
      handler: (value: T) => unknown,
    ) {
      ipcMain.handle(channel, async (event, value) => {
        if (
          event.sender !== window?.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        )
          throw new Error("Untrusted IPC sender.");
        try {
          return await handler(schema.parse(value));
        } catch (e) {
          throw new Error(publicError(e));
        }
      });
    }
    handle("snapshot", z.undefined(), () => snapshot());
    handle("inspect", text, (url) => providers.inspect(url));
    handle("chooseFolder", z.undefined(), async () => {
      const result = await dialog.showOpenDialog(window!, {
        properties: ["openDirectory", "createDirectory"],
        defaultPath: store.settings.destination,
      });
      return result.canceled ? null : result.filePaths[0];
    });
    handle(
      "download",
      z.object({ url: text, destination: folder }),
      async (v) =>
        jobs.addDownload(await providers.inspect(v.url), v.destination),
    );
    handle(
      "upload",
      z.object({
        jobId: id,
        provider,
        name: z
          .string()
          .min(1)
          .max(100)
          .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
          .refine((v) => !v.endsWith(".git")),
        visibility: z.enum(["private", "public"]),
      }),
      (v) => jobs.addUpload(v.jobId, v.provider, v.name, v.visibility),
    );
    handle("cancel", id, (v) => jobs.cancel(v));
    handle("retry", id, (v) => jobs.retry(v));
    handle(
      "saveSettings",
      z.object({
        destination: folder,
        githubClientId: z.string().trim().max(200),
        gitlabClientId: z.string().trim().max(200),
      }),
      async (v) => {
        store.settings = v;
        await store.save();
        emit();
      },
    );
    handle("connect", provider, async (p) => {
      await auth.connect(p);
      emit();
    });
    handle("disconnect", provider, async (p) => {
      if (jobs.busy())
        throw new Error(
          "Finish or cancel active transfers before disconnecting.",
        );
      await auth.disconnect(p);
      emit();
    });
    handle("openFolder", id, async (v) => {
      const error = await shell.openPath(jobs.find(v).folder);
      if (error) throw new Error(error);
    });
    handle("copyUrl", id, (v) => clipboard.writeText(jobs.find(v).repo.url));
    handle("openExternal", text, async (v) => {
      const u = new URL(v);
      if (
        u.protocol !== "https:" ||
        ![
          "github.com",
          "gitlab.com",
          "docs.github.com",
          "docs.gitlab.com",
        ].includes(u.hostname) ||
        u.username ||
        u.password
      )
        throw new Error("Unsupported external link.");
      await shell.openExternal(v);
    });
    window = new BrowserWindow({
      width: 1280,
      height: 900,
      minWidth: 920,
      minHeight: 700,
      backgroundColor: "#0c1017",
      title: "Hedwig",
      icon: path.join(__dirname, "../assets/icon.png"),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (e) => e.preventDefault());
    window.on("close", (e) => {
      if (jobs.busy()) {
        const answer = dialog.showMessageBoxSync(window!, {
          type: "question",
          title: "Transfers are running",
          message: "Close Hedwig and interrupt active transfers?",
          detail:
            "You can retry interrupted transfers next time you open the app.",
          buttons: ["Keep open", "Close Hedwig"],
          defaultId: 0,
          cancelId: 0,
        });
        if (answer === 0) e.preventDefault();
      }
    });
    if (!app.isPackaged && process.env.HEDWIG_DEV_URL)
      await window.loadURL(process.env.HEDWIG_DEV_URL);
    else await window.loadFile(path.join(__dirname, "../dist/index.html"));
  })
  .catch((e) => {
    dialog.showErrorBox("Hedwig could not start", publicError(e));
    app.quit();
  });
app.on("window-all-closed", () => app.quit());
