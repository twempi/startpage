# Terminal Start Page

A keyboard-driven browser start page with Stylix theming and centralized settings.

## Look

The layout follows [kencx/startpage](https://github.com/kencx/startpage): an
image with the time and weather under it on the left, and on the right the
terminal prompt as the heading (`edward@<hostname>$ _`) above plain-text
bookmark columns. Colours come from Stylix (Gruvbox Dark is the fallback when
no Stylix CSS loads) and the font is the Stylix monospace font. The renderer
picks text and link colours that reach 4.5:1 contrast on every scheme.

Bookmark categories are shown 8 per page (4 columns x 2 rows) in the order
they have in `:bookmarks`; reorder categories there to move them between
pages. Switch pages with `Alt+←` / `Alt+→` or the `[1] 2` indicator. Typing
searches every page and jumps to the page holding the best match.

The prompt shows the device hostname when the renderer gets `hostname`
(the Helium/LibreWolf extensions pass `networking.hostName` from `.dotnix`);
otherwise, as on the shared hosted site, it shows the browser name.

To change the side image, replace `img/cat.webp` (or point the `side-image`
`<img>` in `index.html` at another file in `img/`). The current image is
kencx's cat gif (art by avogado6), converted to WebP.

## Source layout

- `index.html`, `style.css`, `script/`, `icon/`, `img/`, and `version/`: startpage assets.
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
The status in the bottom-left corner shows syncing, synced, offline, or stale
settings with muted text and a green dot when synced or a red dot otherwise.
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
