# Preparing a release

The release source of truth is the root [package.json](../package.json). Keep its version and both root version fields in [package-lock.json](../package-lock.json) equal. The optional OAuth broker has its own version and release lifecycle.

## Local preparation

1. Include the intended source changes and update the affected feature docs.
2. Set the app version and write user-facing notes in `docs/releases/<version>.md`. See [1.2.2](releases/1.2.2.md).
3. Run `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`.
4. Run `npm run dist:win`, `npm run dist:mac` or `npm run dist:linux` on the appropriate platform. Output goes into the ignored `release/` directory. These commands do not publish.
5. Inspect the packaged app and smoke-test the changed flows with a disposable profile/repository. Check the displayed version, startup with saved repositories, window-mode restoration, remote publication, comparison, recovery and commit drafts.
6. Commit the release changes, then create the matching annotated tag, for example `git tag -a v1.2.2 -m "Git Manager 1.2.2"`. Confirm it points at the release commit and the working tree is clean.

[electron-builder.yml](../electron-builder.yml) includes only the production `out/main`, `out/preload` and `out/renderer` bundles, app metadata and runtime dependencies. Temporary files or test profiles elsewhere in `out/` must stay out of installers.

## Publication

Pushing the release branch and `v<version>` tag starts [the release workflow](../.github/workflows/release.yml). This publishes a public release once its required jobs succeed; a local commit or tag alone does not publish anything.

The workflow checks the tag against the app version, creates one draft release, and uses the matching notes file. If no notes file exists, it falls back to GitHub-generated notes. Reruns reuse the existing release.

Each platform job runs type checking, lint and tests before building and uploading. Windows x64/arm64 NSIS installers and macOS arm64 DMG/ZIP builds are required. Linux x64 AppImage/DEB builds are optional. The draft becomes public after the required jobs succeed; verify the downloadable installers and update feeds (`latest.yml`, `latest-mac.yml`, and `latest-linux.yml` when Linux succeeds).

Signing and notarization secrets are described in the [README](../README.md#package). Without configured signing, the existing unsigned/ad-hoc distribution behavior applies. Cross-platform checks for the new commit run in GitHub Actions after it is pushed; a previous release's green CI is not validation of the new release.

After publication, install or update on each supported platform and verify startup, repository access and the changed flows. Keep the release draft if any required build or update feed is missing, or a smoke test exposes repository corruption, lost edits or unusable startup.

## Withdrawal and recovery

If a published release has a critical regression, return it to draft to stop offering it through the release feed, investigate, and publish a corrected version with a new tag. Do not move an already published tag. Users already on the affected version can reinstall a previous release; auto-update does not automatically downgrade them.

Keep the user's profile and repositories intact when reinstalling. Recovery refs introduced in 1.2.0 live in each repository and remain reachable independently of the app version. Save current edits before attempting a manual Git repair.
