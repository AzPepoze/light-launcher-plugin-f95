[Back to README](../README.md)

# Settings

The launcher builds the plugin's settings form from [settings.schema.json](../settings.schema.json).
Open the plugin's settings in the launcher to change these values.

> [!NOTE]
> Download hints and the browser route are read again for each download, so a change applies
> without a restart. The other settings are read when the plugin starts.

## Settings by group

Each setting has a default. An empty or missing value uses the default.

### Downloads

| Setting | Key | Default | What it does |
|---|---|---|---|
| Preferred file hosts | `preferredHosts` | empty | Lists these file hosts first, in the order you set. Other links keep the thread's order |
| Preferred platform | `preferredPlatform` | `any` | Shows only the links for one platform: `windows`, `linux` or `mac`. `any` shows all links |
| Save downloads into | `downloadRoot` | `downloads` | The launcher's downloads folder, or its games folder (`games`) |
| Put each game in its own folder | `gameSubfolder` | on | Saves each game under a folder named after its title. The title is made safe as one folder name |
| Unpack the archive after download | `installAfterDownload` | off | The launcher unpacks the archive after the download finishes |
| Delete the archive after install | `deleteArchiveAfterInstall` | off | Removes the archive after a good unpack. Only used when unpacking is on. Advanced |

> [!TIP]
> Hosts you can rank: `pixeldrain`, `mediafire`, `workupload`, `datanodes`, `krakenfiles`, `buzzheavier`, `mixdrop`, `mega`.

> [!NOTE]
> Links whose platform is unknown are always shown, so a filter never hides them.

### Where downloads go

The launcher has two download roots: its downloads folder and its games folder. It does not
let a plugin choose an absolute folder. The plugin answers with a root (`downloadRoot`) and,
when **Put each game in its own folder** is on, one subfolder named after the game title.
The title is made safe as one folder name with the SDK's
[folder name rules](https://github.com/AzPepoze/light-launcher-plugin-sdk/blob/main/docs/download-hints.md#folder-names).
In short: forbidden characters are removed, the name is capped at 200 bytes, and a Windows
device name such as `CON` gets an underscore.

Saving into the games folder, or unpacking after the download, needs the `$GAMES` folder
permission in [plugin.json](../plugin.json). The launcher then checks the folder path and
queues the file itself.

### Updates

| Setting | Key | Default | What it does |
|---|---|---|---|
| Update check interval | `updateCheckIntervalHours` | `0` | The least time between update checks of one game, in hours. `0` checks every time. Range: 0 to 720 |

Inside the interval the plugin does not contact F95 Zone and reports no update for that game.
The timer is kept in memory, so it starts again when the plugin restarts.

### Network

| Setting | Key | Default | What it does |
|---|---|---|---|
| Delay between requests | `requestDelayMs` | `0` | Extra wait, in milliseconds, between two requests to any site. Range: 0 to 10000 |
| Browser identity | `userAgent` | Chrome 126 on Windows | The User-Agent header sent to F95 Zone. Advanced |

> [!NOTE]
> The launcher's own rate limit spaces requests to one site by 250 ms. This setting adds to
> that wait; the plugin does not change the launcher's limit.

### Browser

| Setting | Key | Default | What it does |
|---|---|---|---|
| Browser assist | `browserAssistEnabled` | on | Opens a browser so you can finish the download step, then catches the file link. When off, those downloads fail with a message |

> [!NOTE]
> The plugin only asks the launcher to open the page; you press the download button or
> solve the check yourself. The launcher observes the download and returns the link.

### Debug

| Setting | Key | Default | What it does |
|---|---|---|---|
| Verbose logging | `verboseLogging` | off | Writes one debug line for each request: host name, status and time. Paths are not logged |
| Page dump folder | `dumpDir` | empty | Saves pages that fail to parse here as `.html` files. Empty turns this off. Advanced |

> [!WARNING]
> Saved pages can contain your account name. Turn on the page dump only when you report a parsing problem.

## Not available

The plugin cannot set these. The launcher owns these steps.

| Wanted setting | Why it is not here |
|---|---|
| Absolute download folder | The launcher only has the downloads and games roots. Use the download settings above |
| Skip extras, prefer patch over full | The plugin does not keep whether a link is in a patch or extras section |
| Pre-releases | The plugin does not read a pre-release flag from threads |
| Maximum requests per minute | Use the delay between requests. The launcher already limits each site |

## Startup options

The plugin also gets these values when the launcher starts it. See [protocol.md](protocol.md).

| Field | Type | What it does |
|---|---|---|
| `apiVersion` | string | Must be `"1"` |
| `dataDir` | string | Folder for the thread index and the profile overlay |

## Profile overlay

The forum selectors live in the plugin's built-in profile. To fix a selector without a
new build, put an overlay file in the data folder:

```
<dataDir>/profiles/f95zone.local.json
```

| Rule | Effect |
|---|---|
| Objects merge | Only the keys you write are replaced |
| Arrays replace | `selectors.postBody: [".new"]` replaces the whole list |
| Missing file | The built-in profile is used |

> [!NOTE]
> The plugin reads the overlay when it starts. A change takes effect on the next start.
