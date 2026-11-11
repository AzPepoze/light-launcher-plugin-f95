[Back to README](../README.md)

# Install and sign in

## What you need

| Item | Why |
|---|---|
| The plugin binary for your system | Runs the plugin |
| `plugin.json` | Tells the launcher what the plugin is and what it may access |
| An F95 Zone account | Needed for threads that require a login |
| Chrome, Edge or Chromium | Only for the old external browser route (`useExternalChrome`), where the plugin opens its own window to catch a download link |

## Folder layout

The paths in `plugin.json` are relative to the plugin folder.

```
f95/
├── plugin.json
└── bin/
    ├── linux-x64/f95
    └── windows-x64/f95.exe
```

## Sign in

The plugin needs your session cookie from F95 Zone.

1. Log in to F95 Zone in your browser.
2. Open the developer tools and copy the `Cookie` request header.
3. Give the header to the launcher. The launcher passes it to the plugin, which checks it and saves it in the launcher's secret store.

> [!WARNING]
> The cookie gives full access to your account. Do not share it. Sign out of F95 Zone to end the session.

## Check the sign in

Ask the plugin for `source.authStatus`. See [protocol.md](protocol.md#requests-from-the-launcher).

| Status | Meaning |
|---|---|
| `ok` | Signed in. The `user` field has the account name. |
| `unconfigured` | No cookie saved yet. |
| `expired` | The cookie no longer works. Sign in again. |
| `error` | The site could not be reached, or it refused the request. |
