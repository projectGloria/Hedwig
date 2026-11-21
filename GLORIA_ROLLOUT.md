# GloriaSetup rollout

Pushing a tag like `v1.2.0` runs `.github/workflows/release.yml`, which builds Hedwig and attaches `Hedwig_1.2.0_x64-setup.exe` to that tag's release.

## Please

- Check that `%APPDATA%\Hedwig` is the real settings folder. It is Electron's default `userData` (the app sets no custom path), and Windows paths are case-insensitive, so it also covers `hedwig` from `package.json`. Downloaded archives go to `Downloads\Hedwig` and are deliberately not listed as app data, so uninstalling never deletes them.
- Add the `WINDOWS_PFX_BASE64` and `WINDOWS_PFX_PASSWORD` repository secrets. Without them the setup is unsigned and SmartScreen may warn.
- Confirm `legacy_names = ["Hedwig"]`. The old NSIS installer used `productName` "Hedwig" as its DisplayName.
- `version` in `gloria.toml` is 1.0.0, from `package.json`; the launcher catalogue says 0.2.0. The tag version wins at pack time, so keep `package.json` and the catalogue in line with your tags.
- `needs_webview2` is false because Hedwig is Electron and ships its own Chromium, so no WebView2 bootstrapper is bundled.
- The workflow packs `release\win-unpacked` (Electron runtime, app, bundled Git) built with `electron-builder --win dir`. The old NSIS installer step (`npm run dist`) is not used. Tests are not run in the release workflow.
- Nothing was built locally, and the branch was not pushed or tagged.
