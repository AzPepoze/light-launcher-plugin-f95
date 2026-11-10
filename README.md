# Light Launcher F95 plugin

A source plugin for F95 Zone. It reads forum thread pages with your own account, finds download links, and checks threads for new versions.

It runs as a separate program. The launcher starts it, talks to it over stdin and stdout, and stops it when done. If the plugin crashes, the launcher keeps running.

> [!IMPORTANT]
> **Legal notice**
>
> - Use this plugin only with accounts you own.
> - Download only content you have the right to get.
> - The plugin does not bypass paywalls or access control.
> - It is installed by the community. It is not in the default plugin registry.

## Quick start

| Step | Command |
|---|---|
| 1. Install packages | `bun install` |
| 2. Run the tests | `bun test` |
| 3. Build for Linux | `bun run build:linux` |

## More

| Topic | Page |
|---|---|
| Install and sign in | [docs/install.md](docs/install.md) |
| Startup options | [docs/settings.md](docs/settings.md) |
| Messages the plugin understands | [docs/protocol.md](docs/protocol.md) |
| Development, tests and builds | [docs/development.md](docs/development.md) |
