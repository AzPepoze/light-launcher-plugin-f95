[Back to README](../README.md)

# Development, tests and builds

## Commands

| Command | What it does |
|---|---|
| `bun install` | Installs packages |
| `bun test` | Runs the tests |
| `bun run typecheck` | Checks types without writing files |
| `bun run validate` | Checks `plugin.json` and the settings form |
| `bun run build:linux` | Builds `bin/linux-x64/f95` |
| `bun run build:windows` | Builds `bin/windows-x64/f95.exe` |

Builds use `bun build --compile`. The result is one program with no separate Bun install needed.

## Layout

| Path | Contents |
|---|---|
| `src/main.ts` | Entry point. Starts the stdio server |
| `src/plugin.ts` | Method handlers and run state, passed to `servePlugin` |
| `src/host.ts` | `HostServices`: the SDK services plus the plugin's browser, cookie and index |
| `src/settings.ts` | Reads, defaults and clamps the host settings |
| `src/transport.ts` | Adds the per-request debug line; the logger comes from the SDK |
| `src/credential.ts` | The cookie in the host secret store, cached in memory |
| `src/cache.ts` | The thread index, stored as `sitemap.json` in the data folder |
| `src/browser-assist.ts` | Opens the launcher's browser for download links |
| `src/providers/xenforo/` | Forum engine: parses threads, listings and accounts |
| `src/providers/f95/` | F95 Zone, built on the forum engine |
| `profiles/f95zone.json` | Selectors and host rules for F95 Zone |
| `src/downloads/` | Host preferences, resolvers and MEGA link handling |
| `src/library/f95-index.ts` | Builds the thread index from the sitemap |

## SDK

The protocol types, the stdio server and the helpers come from `@light-launcher/plugin-sdk`.
The dependency points at the SDK folder next to this repo:

```json
"@light-launcher/plugin-sdk": "file:../light-launcher-plugin-sdk"
```

> [!IMPORTANT]
> `bun install` copies the SDK into `node_modules`. Run `bun install` again after the SDK changes.

> [!NOTE]
> CI checks out the [SDK repository](https://github.com/AzPepoze/light-launcher-plugin-sdk) next to this repo before `bun install`, because the package is not published yet. That checkout goes away once the SDK is on a registry.

## Tests

Tests use in-memory fakes from `tests/fakes.ts`. They do not contact F95 Zone or start a browser. They read HTML fixtures from `tests/fixtures/`.

| Test file | Checks |
|---|---|
| `manifest.test.ts` | `plugin.json` against the SDK schema (skipped when `ajv` is missing) |
| `stdio.test.ts` | Runs the plugin over stdio: initialize, parseRef, authStatus, shutdown |
| `profile.test.ts` | The profile overlay in the data folder |
| `browser-assist.test.ts` | The launcher's browser route and its setting |
| `browse.test.ts` | Browse, index search, filters and cursors |
| `credential.test.ts` | The cookie read and write cache |
| `download-assist.test.ts` | Resolver selection, success and browser-assist fallback |
| `download-hosts.test.ts` | Header scoping and look-alike host rejection |
| `file-preferences.test.ts` | Preferred host order and platform filtering |
| `http-routing.test.ts` | Requests go through the host, never `fetch` |
| `mega.test.ts` | MEGA link parsing, key derivation and decrypt fields |
| `resolvers.test.ts` | The file-host resolver table |
| `settings.test.ts` | Schema defaults and settings parsing |
| `transport.test.ts` | Request logging and spacing |
| `update-interval.test.ts` | The minimum time between update checks |
| `xenforo.test.ts` | Thread, listing and account parsing, plus provider wiring |

To run the stdio test against the built binary:

```bash
F95_PLUGIN_BIN=$PWD/bin/linux-x64/f95 bun test tests/stdio.test.ts
```

To change the built-in profile, edit `profiles/f95zone.json` and rebuild. The compiled binary embeds the profile. For a quick fix, use the overlay in [settings.md](settings.md#profile-overlay).
