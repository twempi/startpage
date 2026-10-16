# Terminal Start Page

A keyboard-driven browser start page with Stylix theming and centralized settings.

## Source layout

- `index.html`, `style.css`, `script/`, `icon/`, and `version/`: startpage assets.
- `focus/` and `manifests/chrome.json`: Chromium extension entry point and manifest.
- `lib/mkStylixStartpage.nix`: renderer used by the currently hosted site.
- `settings-api.py`: settings API used by the hosted site and extension.
- `settings.default.json`: declarative defaults for the settings server.
- `test/runtime-settings.test.js`: settings cache regression test.

Nix packaging lives in `twempi/nix-inputs`. This project can be consumed there
as a source-only flake input (`flake = false`) once its GitHub repository exists.

The original source in `dotnix` is still required by the `t480s` Caddy module.
It can be removed after that module uses a pinned remote source for the site,
renderer, settings API, and default settings. Live settings remain on the server
at `/var/lib/startpage/settings.json` and are not part of this source tree.

## Settings synchronization

Both the hosted page and the extension read settings from `GET /api/settings`
before initializing. After two seconds without a response, the extension uses
its browser-local cache; without a cache, the page uses its built-in defaults.
The status beneath the terminal shows syncing, synced, offline, or stale settings.
Returning to a tab or reconnecting to the network checks for newer settings
without replacing open forms. Reload to apply them.

The API returns a `_revision` fingerprint of the settings file. Saves must
include the revision that was loaded. The server checks it and writes under
one lock, rejecting stale saves with HTTP 409 and older clients without a
revision with HTTP 428. Cached settings with a revision can be saved after
reconnecting if the server file is still unchanged. Legacy caches and built-in
defaults cannot be saved until fresh settings have been loaded.

The live file remains `/var/lib/startpage/settings.json`; no migration is needed.
Deploy the updated settings API on the T480s and rebuild the extension on each
client from the same updated source. Older extensions must be updated before
they can save to the new API. Updating this checkout alone does not change the
pinned source used by your Nix configuration.

## Test

With Node.js and Python 3 available:

```sh
node test/runtime-settings.test.js
python3 -B -m unittest discover -s test -p '*_test.py'
```
