# Build validation

Target: Windows x64. Tested on Windows 11 with Node.js 26, Electron 45, Git for Windows 2.56.0, and Git LFS 3.8.0.

## Automated checks

- TypeScript checking and production renderer/main/preload builds.
- Unit and integration tests cover URL normalization, Windows-safe filenames, path containment, nested submodule URL resolution, latest release selection, pagination, authorization boundaries across redirects, expired authentication, rate-limit errors, and existing destination rejection.
- Streaming tests cover SHA-256 verification, validated range resume, servers ignoring ranges, truncated ranges, corrupt content, and cancellation.
- Real local Git fixtures cover all branches/tags, empty repositories, Git LFS download/checkout/push, and nested submodules referenced only in historical commits.
- Transfer tests cover persisted interruption state, upload checkpoint retries, replaced-destination rejection, and reconciliation of a lost create response using a unique persisted marker.
- Mocked provider tests stream real file bytes to GitHub release endpoints and GitLab package registry endpoints, and verify that GitLab release links point to the destination copy.
- Electron smoke checks cover navigation, account setup, URL validation, Windows encryption round-trip, and screenshots.
- Live public GitHub check downloads `octocat/Hello-World`, checks the completed manifest and browsable checkout, opens upload options, verifies private visibility by default, and checks saved history after restarting.
- All **33 tests passed**. The production build and dependency audit passed (zero reported vulnerabilities).
- The packaged `Hedwig.exe` passed both Electron smoke suites, including the live download using bundled Git, Windows credential encryption, and persistence across restart.
- The packaged credential helper was checked with synthetic credentials: GitHub and GitLab hosts receive only their matching credential; unrelated hosts receive none.
- A live release asset from `jqlang/jq` (`jq-1.8.2`, `sha256sum.txt`, 2,302 bytes) was downloaded through the release asset API and verified against its supplied SHA-256 digest.

## Account-dependent checks

Live GitHub/GitLab OAuth authorization, private-source access, token refresh against GitLab, and creation/upload in real provider accounts require the user's OAuth application registrations and dedicated test repositories. These checks have **not** been performed with real accounts. No repository has been published to an external account during implementation.

The installer is unsigned. This build does not claim a publisher signature or Windows SmartScreen reputation. Windows 10 was not available for a separate installation test.
