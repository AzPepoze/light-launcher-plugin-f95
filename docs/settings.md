[Back to README](../README.md)

# Startup options

The launcher sends these values in the `initialize` request. See [protocol.md](protocol.md).

## Options

| Field | Type | Required | Default | What it does |
|---|---|---|---|---|
| `apiVersion` | string | yes | | Must be `"1"`. |
| `dataDir` | string | yes | | Folder for the browser profile and the thread index. |
| `credential` | string or null | no | null | F95 Zone cookie header. |
| `userAgent` | string | no | Chrome 126 on Windows | Browser identity sent to F95 Zone. |
| `rateLimitMs` | number | no | 1200 | Minimum wait between requests to one host. |
| `browserPath` | string or null | no | null | Browser executable for browser assist. Null means the usual install paths. |
| `dumpDir` | string or null | no | null | When set, pages that fail to parse are saved here as `.html`. |

> [!TIP]
> Leave `dumpDir` empty unless you are reporting a parsing problem. Saved pages can contain your account name.
