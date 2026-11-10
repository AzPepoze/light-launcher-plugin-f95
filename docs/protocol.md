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
| `source.prepareDownload` | `{ source, file, game }` | `{ url, headers }` |
| `source.checkUpdate` | `{ source, game }` | `{ update }`, or null when nothing is newer |
| `source.sync` | `{ source }` | `{ count, syncedAt, running }` after the thread index is rebuilt |
| `shutdown` | none | null. The plugin then exits. |

### initialize

| Field | Type | What it is |
|---|---|---|
| `hostVersion` | string | Launcher version |
| `apiVersion` | string | Must be `"1"` |
| `platform` | string | `windows`, `linux`, `mac`, `android` or `unknown` |
| `grantedPermissions` | object | What the user allowed. `browser` decides where browser windows come from |
| `dataDir` | string | Private folder. The thread index and the profile overlay live here |

The launcher never sends the cookie in `initialize`. See [Sign in](install.md#sign-in).

## Services the plugin calls

| Method | When | What for |
|---|---|---|
| `secrets.get` | First use after start | Reads the cookie, key `cookie` |
| `secrets.set` | After `source.setCredential` works | Saves the cookie |
| `secrets.delete` | After `source.clearCredential` | Removes the cookie |
| `settings.get` | Once, in `initialize` | Reads [startup options](settings.md). Defaults apply if the host cannot answer |
| `browser.assist` | `source.prepareDownload` for an F95 `/dl/` link, when the browser permission is granted | Opens a browser and catches the file link. See [Browser assist](#browser-assist) |

> [!NOTE]
> The plugin fetches forum pages itself. It does not use `http.request`.

## Notifications

| Sent by | Method | Params | Meaning |
|---|---|---|---|
| Plugin | `progress` | `{ id, message }` | Progress for the request `id`. Sent while the thread index builds |
| Launcher | `cancel` | `{ id }` | Stops the request. A browser capture in progress stops waiting |
| Launcher | `browser.waiting` | `{ token, message }` | The user must act, such as press Download File |
| Launcher | `browser.progress` | `{ token, percent, message? }` | Progress of the browser capture |

## Browser assist

The plugin needs a browser to catch the download link behind an F95 `/dl/` page.
The browser comes from the launcher or from the plugin.

| Situation | Browser used |
|---|---|
| The launcher granted the `browser` permission | The launcher's `browser.assist` |
| The launcher answers "method not found" | The plugin's local browser, for the rest of the run |
| The permission was not granted | The plugin's local browser |

> [!NOTE]
> The local browser needs Google Chrome, Microsoft Edge or Chromium installed.
> A capture from the launcher returns no cookie headers. The local browser returns the
> cookies the download needs.

## Errors

| Code | Meaning |
|---|---|
| -32600 | Not a valid request, or a source request came before `initialize` |
| -32601 | Unknown method |
| -32602 | Missing or wrong params |
| -32603 | The plugin failed. The message says why. |
