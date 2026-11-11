# Light Launcher F95 plugin

A source plugin for F95 Zone. Its main job is to check the games in your library for new versions.

It runs as a separate program. The launcher starts it, talks to it over stdin and stdout, and stops it when done. If the plugin crashes, the launcher keeps running.

## What this plugin is for

> [!NOTE]
> This is a small personal project, not an F95 Zone product, and it is not affiliated with or endorsed by F95 Zone.
> It exists to check whether the games you already follow have a new version. It is not meant to bypass F95 Zone.

| It does | It does not |
|---|---|
| Sign in with your own account | Solve or skip CAPTCHAs |
| Read the thread pages of games you add | Share or collect other people's accounts |
| Check those threads for a new version | Open masked links in a special way |
| Read the download links that a thread shows, so the launcher can offer them to you | Get around paywalls or access limits |

> [!IMPORTANT]
> **Honest notice**
>
> - Use this plugin only with an account you own.
> - Download only content you have the right to get.
> - F95 Zone may not allow automated tools. I have not asked them for permission yet.
> - I can remove this repository at any time. If you are from F95 Zone, or you own content shown here, please contact me through an issue on this repository and I will respond and take it down if you ask.
> - It is installed by the community. It is not in the default plugin registry.

## Quick start

| Step | Command |
|---|---|
| 1. Install packages | `bun install` |
| 2. Run the tests | `bun test` |
| 3. Build for Linux | `bun run build:linux` |
| 4. Build for Windows | `bun run build:windows` |

## Downloads and browser help

| Setting | Default | What it does |
|---|---|---|
| Save downloads into | downloads folder | Chooses the launcher's downloads folder or its games folder |
| Put each game in its own folder | on | Adds a safe folder named after the game title |
| Unpack the archive after download | off | Asks the launcher to unpack after the download |
| Delete the archive after install | off | Removes the archive after a good unpack |
| Browser assist | on | Opens a browser for pages that need a person |
| Use external Chrome (old route) | off | Uses the plugin's own Chrome or Edge over CDP instead of the launcher's embedded browser |

The launcher only has two download roots, so the plugin chooses a root and a subfolder,
never an absolute folder. See [Settings](docs/settings.md#where-downloads-go).

Some file hosts need a timer, login, captcha or button before they give the file. The
plugin never clicks or fills that page. It asks the launcher to open an embedded window,
you do the step, and the launcher catches the download. The old external Chrome route is
still available with `useExternalChrome`; it needs Chrome, Edge or Chromium installed.

## Permissions

| Permission | Why |
|---|---|
| `network` | Reads F95 Zone and the supported file hosts |
| `fs` `$GAMES` | Download hints can save into the games folder or unpack there |
| `secrets` | Stores your F95 session cookie |
| `browser` | Opens the embedded browser window for a page that needs a person |

## More

| Topic | Page |
|---|---|
| Install and sign in | [docs/install.md](docs/install.md) |
| Settings | [docs/settings.md](docs/settings.md) |
| Messages the plugin understands | [docs/protocol.md](docs/protocol.md) |
| Development, tests and builds | [docs/development.md](docs/development.md) |
| Releasing | [docs/releasing.md](docs/releasing.md) |
