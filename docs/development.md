[Back to README](../README.md)

# Development, tests and builds

## Commands

| Command | What it does |
|---|---|
| `bun install` | Installs packages |
| `bun test` | Runs the tests |
| `bun run typecheck` | Checks types without writing files |
| `bun run build:linux` | Builds `bin/linux-x64/f95` |
| `bun run build:windows` | Builds `bin/windows-x64/f95.exe` |

Builds use `bun build --compile`. The result is one program with no separate Bun install needed.

## Layout

| Path | Contents |
|---|---|
| `src/main.ts` | Entry point. Starts the stdio server |
| `src/plugin.ts` | Method handlers and run state, passed to `servePlugin` |
| `src/host.ts` | `HostServices`: what the launcher gives the plugin |
| `src/credential.ts` | The cookie in the host secret store, cached in memory |
| `src/browser-assist.ts` | Chooses the host or the local browser for download links |
| `src/providers/xenforo/` | Forum engine: parses threads, listings and accounts |
| `src/providers/f95/` | F95 Zone, built on the forum engine |
| `profiles/f95zone.json` | Selectors and host rules for F95 Zone |
| `src/downloads/resolvers/` | Turns file-host pages into direct links |
| `src/downloads/browser/` | Local browser (Chrome DevTools) for download links |
| `src/library/f95-index.ts` | Builds the thread index from the sitemap |

## SDK

The protocol types, the stdio server and the helpers come from `@light-launcher/plugin-sdk`.
The dependency points at the SDK folder next to this repo:

```json
"@light-launcher/plugin-sdk": "file:../light-launcher-plugin-sdk"
```

> [!IMPORTANT]
> `bun install` copies the SDK into `node_modules`. Run `bun install` again after the SDK changes.

## Tests

Tests use in-memory fakes from `tests/fakes.ts`. They do not contact F95 Zone or start a browser. They read HTML fixtures from `tests/fixtures/`.

| Test file | Checks |
|---|---|
| `manifest.test.ts` | `plugin.json` against the SDK schema (skipped when `ajv` is missing) |
| `stdio.test.ts` | Runs the plugin over stdio: initialize, parseRef, authStatus, shutdown |
| `profile.test.ts` | The profile overlay in the data folder |
| `browser-assist.test.ts` | Host or local browser choice |

To run the stdio test against the built binary:

```bash
F95_PLUGIN_BIN=$PWD/bin/linux-x64/f95 bun test tests/stdio.test.ts
```

To change the built-in profile, edit `profiles/f95zone.json` and rebuild. The compiled binary embeds the profile. For a quick fix, use the overlay in [settings.md](settings.md#profile-overlay).
