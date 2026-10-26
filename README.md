# Hedwig

A Windows desktop app for keeping complete Git repositories and their latest release files, with uploads to your personal GitHub or GitLab account.

## Run and build

Requires Node.js 22.12+ and Git for Windows with Git LFS for development. Packaged installations include Git and LFS.

```powershell
npm ci
npm run dev
```

```powershell
npm test
npm run build
npm run test:ui
npm run dist
```

The installer is written to `release/Hedwig-Setup-1.0.0-x64.exe`. It is unsigned. The build script bundles the installed Git for Windows distribution, including component notices; set `HEDWIG_GIT_ROOT` to a distribution root to choose another installation. It retrieves the Git LFS license over HTTPS. `npm run start` runs the compiled app.

## Using Hedwig

1. Paste an HTTPS repository or release-page URL from github.com or gitlab.com. Nested GitLab groups are supported.
2. Choose a destination and optionally preview the repository and latest release assets.
3. Download. Progress and failures appear under Transfers; completed downloads appear under My archives.
4. Open a completed archive's options menu to upload to GitHub or GitLab. Connect the destination account, choose a new repository name and visibility, and start the upload.

Public downloads require no account. One account per provider can be connected at a time. Transfers are queued serially. Cancel stops an active transfer; Retry preserves completed stages and resumes asset files when the server supports validated ranges. If Hedwig closes during work, the next launch marks those jobs interrupted and offers Retry.

## Browser sign-in setup

Open **Connected accounts**. Client IDs are public identifiers; never paste client secrets into Hedwig.

### GitHub

Create an OAuth application at https://github.com/settings/applications/new. Set a homepage URL (for personal setup, `https://github.com` is sufficient), set its callback URL to `http://127.0.0.1:43821/oauth/callback`, and enable **Device Flow** in the application settings. Copy its client ID into Hedwig. Sign in and enter the displayed code in the GitHub browser window. Hedwig requests `repo workflow` to create repositories and preserve workflow files. Organization policies may require additional approval for source access.

### GitLab

Create an application at https://gitlab.com/-/user_settings/applications. Disable **Confidential**, register exactly `http://127.0.0.1:43821/oauth/callback`, and enable `api`, `read_repository`, and `write_repository`. Copy its application ID into Hedwig. Browser sign-in uses PKCE and state validation; the local callback listener runs only during sign-in. Port 43821 must be available.

Tokens and refresh tokens are encrypted using Electron safeStorage / Windows DPAPI and saved under the app's Windows user-data directory. Disconnect removes local credentials; revoke the app in the provider's settings to invalidate authorization server-side. Git receives credentials through a host-scoped helper. Tokens are never written to repository remotes or manifests.

## Archive layout

```text
repository-name-<job-id>/
  manifest.json            # Metadata, stage checkpoints, asset SHA-256 receipts
  repository.git/          # Bare mirror, all branches and tags, LFS objects
  source/                  # Independent default-branch checkout with LFS content
  submodules/
    index.json             # Source URL, local archive path, required commits
    <url-hash>/            # Bare submodule archive with required historical commits
  release/
    release.json
    RELEASE_NOTES.md
    assets/
```

The source checkout does not populate submodule working directories; historical and nested submodule repositories are independently archived under `submodules`. Submodule archives contain all branches and tags plus required commits the server permits fetching. HTTPS sources and common `git@host:path` submodule URLs are supported (the latter are fetched over HTTPS); unavailable historical objects or unsupported URL protocols produce an explicit failure instead of claiming a complete backup.

The archive mirrors branches and tags with their full histories. Provider-internal refs such as GitHub pull-request refs are outside the archive, consistent with excluding pull-request history. Submodule discovery inspects commits that changed gitlinks or `.gitmodules`, including root commits and merge-parent diffs.

GitHub release selection uses its latest stable release endpoint. GitLab has no prerelease flag, so selection uses the newest non-upcoming published release by release date. Generated source ZIP/tar archives are not duplicated: source and history are already stored in the Git mirror. Every attached release asset/link is downloaded; a non-downloadable link fails visibly. Files are streamed, Windows-safe names are collision-resolved, and provider SHA-256 digests are verified when available. Local SHA-256 receipts are always recorded and rechecked before upload.

## Upload semantics

Uploads create a new repository in the connected user's personal namespace, defaulting to private. Existing repositories cannot be overwritten. Branches and tags are pushed without force, LFS objects are uploaded, and the default branch is set. The latest downloaded release is recreated with title, notes, tag, and assets. GitLab assets are copied into the destination Generic Package Registry and linked from the release. Upload failures retain their stage checkpoints and destination ID for Retry. A deleted or replaced destination is never silently adopted.

Submodule URLs remain unchanged, and submodules are not recreated under the destination account. The destination provider's policies and file/size limits still apply. Issues, PRs, CI history, wikis, provider configuration, older releases, organizations/groups as upload destinations, self-hosted providers, and scheduled synchronization are outside this version.

## Architecture and tests

- `electron/`: validated IPC, encrypted OAuth account handling, provider adapters, streaming HTTP downloads, Git runner, and persistent transfer queue.
- `src/`: isolated React renderer and typed desktop API. No filesystem, token, or Git access in the renderer.
- `tests/`: URL/path validation, credential boundaries, pagination, release selection, streaming resume/checksums/cancellation, durable transfer retries, and real local Git/LFS/submodule fixtures.
- `scripts/ui-smoke.mjs`: real Electron navigation, setup dialog, validation, encryption round-trip, and screenshots. Set `HEDWIG_TEST_EXE` to exercise a packaged executable.

Network transfers and Git work stay outside the renderer. Downloaded files are never executed. Child Git operations disable user/system configuration and hooks, and are terminated as a process tree when cancelled. Asset credentials are restricted to the originating provider through redirects.

Authenticated end-to-end tests require registered OAuth applications and dedicated repositories in your provider accounts. They cannot be completed using mock credentials. See `VALIDATION.md` for the checks completed for this build.
