[Back to README](../README.md)

# Releasing

How a new version of the F95 plugin is published.

## Cut a release

| Step | What to do |
|---|---|
| 1 | Set the same version in `plugin.json` and `package.json`, for example `1.1.0` |
| 2 | Commit the bump with a Conventional Commit message, such as `chore(release): 1.1.0` |
| 3 | Tag the commit: `git tag v1.1.0` |
| 4 | Push the commit and the tag: `git push origin main --tags` |

The tag starts `.github/workflows/release.yml`. The workflow stops when the tag, without its `v`, does not match the `version` in `plugin.json`.

> [!IMPORTANT]
> Use [semantic versioning](https://semver.org/). A new setting or capability is a minor bump. A fix is a patch bump.

## What a release contains

| File | Contents |
|---|---|
| `f95-<version>.llplugin` | Zip with `plugin.json`, `settings.schema.json`, both binaries, `README.md` and `LICENSE` |
| `SHA256SUMS` | SHA-256 checksum of the `.llplugin` file |

The workflow builds `linux-x64` and `windows-x64` first, then runs `llp pack`. It never publishes a package whose declared files are missing.

## Release notes

Notes are grouped from the Conventional Commit subjects between the previous tag and the new tag. Types such as `feat`, `fix` and `perf` get their own heading; anything else goes under Other.

## Signing

Signing is optional. The workflow reads an ed25519 private key from the repository secret
`PLUGIN_SIGNING_KEY`. Create one with `bunx llp keygen --out keys`; it writes
`keys/private.pem` (the private key) and `keys/trusted_keys` (the public key). Keep the
private key secret.

| Secret | Format |
|---|---|
| `PLUGIN_SIGNING_KEY` | An ed25519 private key in PKCS8 PEM form, such as `keys/private.pem` |

When the secret is set, the workflow writes it to a temporary file and runs
`bunx llp sign dist/<package>.llplugin --key <file>` before it writes `SHA256SUMS`. The
package then gets a `SIGNATURE` file: the base64 ed25519 signature of `SHA256SUMS`. Users
add the matching public key from `keys/trusted_keys` to `<base folder>/plugins/trusted_keys`.
See [Signing packages](https://github.com/AzPepoze/light-launcher-plugin-sdk/blob/main/docs/signing.md)
in the SDK docs and [Plugins](https://github.com/AzPepoze/light-launcher/blob/main/docs/plugins.md#trusted-keys)
in the launcher docs.

When `PLUGIN_SIGNING_KEY` is not set, the release stays unsigned and users need
`--allow-unsigned` to install it.

## Check a download

Linux:

```sh
sha256sum -c SHA256SUMS
```

Windows (PowerShell):

```text
Get-FileHash .\f95-<version>.llplugin -Algorithm SHA256
```

Compare the result with the line in `SHA256SUMS`.

## How users update

Updates are always manual. The plugin does not update itself, and the launcher only updates a plugin when the user asks it to.

1. Open the [releases](https://github.com/AzPepoze/light-launcher-plugin-f95/releases) page and download the newest `.llplugin`.
2. Check it against `SHA256SUMS`.
3. Update the plugin with the launcher:

```text
light-launcher plugin update f95 --allow-unsigned
```

The launcher updates from the path the plugin was installed from. Save the new package over the old one, or install from the new file after removing the old version:

```text
light-launcher plugin remove f95
light-launcher plugin install ./f95-<version>.llplugin --allow-unsigned
```

An unsigned package needs `--allow-unsigned` to install. Removing without `--delete-data` keeps settings and the saved sign-in cookie. To go back to the previous version, run `light-launcher plugin rollback f95`.

## Troubleshooting

| Problem | Cause |
|---|---|
| The workflow fails before the build | The tag and `plugin.json` versions differ |
| The pack step fails | A file declared in `plugin.json` was not built |
| The release job fails to upload | The `GITHUB_TOKEN` is read-only; the publish job needs `contents: write` |
