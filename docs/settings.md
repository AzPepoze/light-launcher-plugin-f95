[Back to README](../README.md)

# Startup options

The plugin reads its options in two places: the `initialize` request and the host settings.
See [protocol.md](protocol.md).

## From initialize

| Field | Type | What it does |
|---|---|---|
| `apiVersion` | string | Must be `"1"` |
| `dataDir` | string | Folder for the thread index and the profile overlay |

## From the host settings

The plugin asks the host for these values with `settings.get`. A missing value uses the default.

| Field | Type | Default | What it does |
|---|---|---|---|
| `userAgent` | string | Chrome 126 on Windows | Browser identity sent to F95 Zone |
| `rateLimitMs` | number | 1200 | Minimum wait between requests to one host |
| `browserPath` | string | none | Browser executable for the local browser. Empty means the usual install paths |
| `dumpDir` | string | none | When set, pages that fail to parse are saved here as `.html` |

> [!TIP]
> Leave `dumpDir` empty unless you are reporting a parsing problem. Saved pages can contain your account name.

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
