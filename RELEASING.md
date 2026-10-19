# Releasing

## Shipping a new version

```
npm run release -- 0.2.0
```

That sets the version everywhere, commits, tags `v0.2.0` and pushes. GitHub Actions
(`.github/workflows/release.yml`) then builds the Windows installer and the Mac app, signs them for
the updater and attaches them, with `latest.json`, to a **draft** release.

Nothing reaches anyone until you publish the draft:

1. Open the repo's Releases page and the new draft.
2. Write what changed in the notes. People see them on GitHub.
3. Press **Publish release**. Within a few hours every installed Mochi Garden finds it (it checks
   about 20 seconds after launch and every 6 hours), and it installs once their mochis are idle.

Your own copy keeps working the way it always has (`npm run ship` installs a local build
straight away). Published releases reach it too.

## The update signing key

Updates are signed, so an installed app only accepts updates made with your private key.

- Private key: `%USERPROFILE%\.tauri\mochi-garden.key` (no password). Also stored as the GitHub
  secret `TAURI_SIGNING_PRIVATE_KEY`.
- Public key: in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).

**Back the private key up somewhere safe** (a password manager). If it's lost, installed copies can
never update again and everyone has to reinstall by hand. If it leaks, someone could push an update
to your users: rotate it and ship a release with the new public key.

## Before going public

- [x] Licence: MIT (`LICENSE`).
- [ ] Decide on Windows code signing. Unsigned installers show "Windows protected your PC" (More
      info → Run anyway). Options: Azure Trusted Signing (about $10/month, individuals in the US and
      Canada) or an OV certificate (about $200–400/year). Either one plugs into the release workflow.
- [x] Make the repository public.
- [x] Publish the first release (see above).
- [x] Mac: builds and runs on a Mac (tested on Apple silicon). Releases include a universal `.dmg`
      and updater bundle, ad-hoc signed.
- [ ] Mac notarisation. Without it the first launch needs System Settings → Privacy & Security →
      Open Anyway. Needs Apple's $99/year developer account; then add the certificate and Apple
      ID secrets to the release workflow's `mac` job (tauri-action reads them).
