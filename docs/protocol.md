[Back to README](../README.md)

# Messages the plugin understands

The launcher and the plugin exchange JSON-RPC 2.0 messages, one JSON object per line.
The message shapes come from the Light Launcher plugin SDK (`@light-launcher/plugin-sdk`).

| Direction | Use |
|---|---|
| Launcher to plugin | Requests. Each one gets a reply with the same `id`. |
| Plugin to launcher | Requests for services (secrets, browser, settings) and notifications. |

> [!NOTE]
> Stdout carries only these messages. Logs go to stderr.

## Requests from the launcher

| Method | Params | Result |
|---|---|---|
| `initialize` | see [below](#initialize) | `{ pluginVersion, capabilities }` |
| `source.authStatus` | `{ source }` | auth state |
| `source.setCredential` | `{ source, value }` | auth state. The cookie is saved only when it works. |
| `source.clearCredential` | `{ source }` | auth state, `unconfigured` |
| `source.parseRef` | `{ url }` | `{ kind, id, url }`, or null |
| `source.search` | `{ source, url?, query?, page? }` | `{ games }` |
| `source.fetchGame` | `{ source, ref }` | `{ game }` |
| `source.resolveFiles` | `{ source, game }` | `{ files }` |
| `source.prepareDownload` | `{ source, file, game }` | `{ url, headers, filename?, size?, root?, subfolder?, install?, installSubfolder?, deleteArchive? }` |
| `source.checkUpdate` | `{ source, game }` | `{ update }`, or null when nothing is newer |
| `source.browse` | `{ source, query?, filters?, sort?, order?, cursor?, limit }` | `{ games, nextCursor?, total? }` for the Library sidebar |
| `source.listFilters` | `{ source, group, query?, limit }` | `{ options }` for a dynamic sidebar group |
| `source.sync` | `{ source }` | `{ count, syncedAt, running }` after the thread index is rebuilt |
| `shutdown` | none | null. The plugin then exits. |

### initialize

| Field | Type | What it is |
|---|---|---|
| `hostVersion` | string | Launcher version |
| `apiVersion` | string | Must be `"1"` |
| `platform` | string | `windows`, `linux`, `mac`, `android` or `unknown` |
| `grantedPermissions` | object | What the user allowed. `browser` allows the launcher's browser window |
| `dataDir` | string | Private folder. The thread index and the profile overlay live here |

The launcher never sends the cookie in `initialize`. See [Sign in](install.md#sign-in).

## Services the plugin calls

| Method | When | What for |
|---|---|---|
| `secrets.get` | First use after start | Reads the cookie, key `cookie` |
| `secrets.set` | After `source.setCredential` works | Saves the cookie |
| `secrets.delete` | After `source.clearCredential` | Removes the cookie |
| `settings.get` | In `initialize`, and for each download | Reads the [settings](settings.md). Defaults apply if the host cannot answer |
| `browser.assist` | `source.prepareDownload` when a file host needs a person, and browser assist is on | Opens a window where you do the step, then catches the file link. See [Browser assist](#browser-assist) |

> [!NOTE]
> Every request goes through the launcher's `http.request`, using the SDK's `HttpClient`
> and `hostTransport`. The launcher applies its network allow-list, rate limit and retries.

## Notifications

| Sent by | Method | Params | Meaning |
|---|---|---|---|
| Plugin | `progress` | `{ id, message }` | Progress for the request `id`. Sent while the thread index builds |
| Launcher | `cancel` | `{ id }` | Stops the request. A browser capture in progress stops waiting |
| Launcher | `browser.waiting` | `{ token, message }` | The user must act, such as press Download File |
| Launcher | `browser.progress` | `{ token, percent, message? }` | Progress of the browser capture |

## Browser assist

Some file-host pages need a person: a timer, a login, a captcha or a download button.
The plugin does not click or fill these pages. It asks the launcher to show the page, and
you do the step in the window. The launcher observes the download and returns the caught
link. Progress messages from the plugin appear on the download row.

| Situation | Browser used |
|---|---|
| `browserAssistEnabled` is on (default) | The launcher's embedded window through `browser.assist` |
| `browserAssistEnabled` is off | No window. The download fails with a clear message |

## Download hints

`source.prepareDownload` may return these fields next to `url` and `headers`:

| Field | Meaning |
|---|---|
| `root` | `downloads` (default) or `games` |
| `subfolder` | Folder under `root`, such as `My Game` |
| `install` | Unpack the archive after the download |
| `installSubfolder` | Folder under the games folder for the installed game. Needs `install` |
| `deleteArchive` | Delete the archive after a good install. Needs `install` |

> [!IMPORTANT]
> The launcher only has the downloads and games roots. A plugin chooses a root and a
> subfolder, not an absolute folder. `root: "games"` and `install` need the `$GAMES` fs
> permission. The launcher checks the path and queues the file itself.

## Errors

| Code | Meaning |
|---|---|
| -32600 | Not a valid request, or a source request came before `initialize` |
| -32601 | Unknown method |
| -32602 | Missing or wrong params |
| -32603 | The plugin failed. The message says why. |
| -32001 | The download needs a permission, such as browser assist |
| -32002 | The browser window was closed, or the request was canceled |
| -32003 | Browser assist timed out before it caught a link |
