[Back to README](../README.md)

# Messages the plugin understands

The launcher and the plugin exchange JSON-RPC 2.0 messages. Each message is one line of JSON on stdin or stdout.

| Direction | Use |
|---|---|
| Launcher to plugin | Requests. Each one gets a reply with the same `id`. |
| Plugin to launcher | Notifications. No reply. |

## Requests

| Method | Params | Result |
|---|---|---|
| `initialize` | see [settings.md](settings.md) | `{ pluginVersion, capabilities, source }` |
| `source.authStatus` | none | auth state |
| `source.setCredential` | `{ value }` | auth state. Saves the cookie if it works. |
| `source.clearCredential` | none | null |
| `source.parseRef` | `{ url }` | `{ kind, id, url }` or null |
| `source.search` | `{ url?, query?, page? }` | game list |
| `source.fetchGame` | `{ ref }` | game |
| `source.resolveFiles` | `{ game }` | file list |
| `source.prepareDownload` | `{ file, game }` | `{ url, headers }` |
| `source.checkUpdate` | `{ game }` | update info or null |
| `source.sync` | none | `{ count, source, syncedAt, running }` after the thread index is rebuilt |
| `browser.capture` | `{ url }` | first download link caught in the browser |
| `browser.close` | none | null |
| `shutdown` | none | null. The plugin then exits. |

## Notifications from the plugin

| Method | Params | When |
|---|---|---|
| `progress` | `{ message }` | Thread index is building |
| `browser.waiting` | `{ message }` | Browser assist is waiting for you to press a download button |
| `credential.changed` | `{ source, value }` | A new cookie was saved. `value` is null when cleared. The launcher stores it. |

## Errors

| Code | Meaning |
|---|---|
| -32700 | Line is not valid JSON |
| -32600 | Not a request |
| -32601 | Unknown method |
| -32602 | Missing or wrong params |
| -32603 | The plugin failed. The message says why. |

Requests before `initialize` return -32600.

> [!NOTE]
> Stdout carries only these messages. Logs go to stderr.
