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

## Test

With Node.js available:

```sh
node test/runtime-settings.test.js
```
