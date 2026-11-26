{
  pkgs,
  source,
  colors,
  fontFamily,
  sansFontFamily ? fontFamily,
  # Device hostname shown in the prompt (edward@<hostname>$). null = show the
  # browser name, e.g. for the hosted site that every device shares.
  hostname ? null,
}: let
  color = name: "#${builtins.getAttr name colors}";

  # --- WCAG contrast guard (pure Nix, build time) ---------------------------
  # Base16 ports are inconsistent (e.g. Everforest keeps grey in base05), so
  # text and link colours are picked/blended until they reach 4.5:1.
  hexDigits = {
    "0" = 0;
    "1" = 1;
    "2" = 2;
    "3" = 3;
    "4" = 4;
    "5" = 5;
    "6" = 6;
    "7" = 7;
    "8" = 8;
    "9" = 9;
    "a" = 10;
    "b" = 11;
    "c" = 12;
    "d" = 13;
    "e" = 14;
    "f" = 15;
  };
  hexByte = hex: i: let
    digit = j: hexDigits.${pkgs.lib.toLower (builtins.substring (i + j) 1 hex)};
  in
    digit 0 * 16 + digit 1;
  channels = hex: map (hexByte hex) [0 2 4];
  toHexByte = n: let
    digits = "0123456789abcdef";
  in
    builtins.substring (n / 16) 1 digits + builtins.substring (pkgs.lib.mod n 16) 1 digits;
  round = x: builtins.floor (x + 0.5);
  # y^(12/5) via a Newton fifth root of y^12 (Nix has no pow).
  pow24 = y: let
    y4 = y * y * y * y;
    a = y4 * y4 * y4;
    step = r: n:
      if n == 0
      then r
      else step (r - (r * r * r * r * r - a) / (5.0 * r * r * r * r)) (n - 1);
  in
    if a <= 0.0
    then 0.0
    else step 1.0 80;
  linear = c8: let
    x = c8 / 255.0;
  in
    if x <= 0.03928
    then x / 12.92
    else pow24 ((x + 0.055) / 1.055);
  luminance = hex: let
    c = map linear (channels hex);
  in
    0.2126 * builtins.elemAt c 0 + 0.7152 * builtins.elemAt c 1 + 0.0722 * builtins.elemAt c 2;
  contrast = a: b: let
    la = luminance a;
    lb = luminance b;
    hi =
      if la > lb
      then la
      else lb;
    lo =
      if la > lb
      then lb
      else la;
  in
    (hi + 0.05) / (lo + 0.05);
  # Blend hex a toward hex b by t (0..1), like color-mix in srgb.
  blend = a: b: t:
    builtins.concatStringsSep "" (pkgs.lib.zipListsWith
      (x: y: toHexByte (round (x * (1.0 - t) + y * t)))
      (channels a)
      (channels b));
  readable = hex: background: text: let
    candidates = map (i: blend hex text (i / 10.0)) (pkgs.lib.range 0 10);
    passing = builtins.filter (c: contrast c background >= 4.5) candidates;
  in
    if passing == []
    then text
    else builtins.head passing;

  bg = colors.base00;
  textCandidates = map (n: colors.${n}) (builtins.filter (n: colors ? ${n}) ["base05" "base06" "base07"]);
  readableText = builtins.filter (c: contrast c bg >= 4.5) textCandidates;
  textHex =
    if readableText != []
    then builtins.head readableText
    else
      builtins.foldl' (best: c:
        if contrast c bg > contrast best bg
        then c
        else best)
      colors.base05
      textCandidates;
  # base04/base09 are optional so partial palettes (e.g. nix-inputs defaults) still build.
  linkHex = readable (colors.base04 or (blend colors.base05 bg 0.35)) bg textHex;
  linkHoverHex = readable (colors.base09 or colors.base0A) bg textHex;
  textColor = "#${textHex}";
  linkColor = "#${linkHex}";
  linkHoverColor = "#${linkHoverHex}";
  # ---------------------------------------------------------------------------

  cssMonoFontFamily = builtins.toJSON fontFamily;

  validHostname =
    if hostname == null
    then null
    else if builtins.match "[A-Za-z0-9][A-Za-z0-9.-]{0,62}" hostname != null
    then hostname
    else throw "mkStylixStartpage: invalid hostname ${builtins.toJSON hostname}";

  cacheInputs = {
    inherit fontFamily sansFontFamily;
    hostname = validHostname;
    base00 = colors.base00;
    base01 = colors.base01;
    base02 = colors.base02;
    base03 = colors.base03;
    base04 = colors.base04 or null;
    base05 = colors.base05;
    base06 = colors.base06 or null;
    base07 = colors.base07 or null;
    base08 = colors.base08;
    base09 = colors.base09 or null;
    base0A = colors.base0A;
    base0B = colors.base0B;
    base0C = colors.base0C;
    base0D = colors.base0D;
    base0E = colors.base0E;
  };
  cacheKey = builtins.substring 0 12 (
    builtins.hashString "sha256" (builtins.toJSON cacheInputs)
  );

  baseCss = builtins.readFile (source + "/style.css");
  stylixBackground = color "base00";

  baseCssStyle = pkgs.writeText "startpage-base-css.html" ''
    <style id="startpage-base-css">
    ${baseCss}
    </style>
    <link rel="stylesheet" href="stylix.css?v=${cacheKey}" />
  '';

  stylixCss = pkgs.writeText "startpage-stylix.css" ''
    html.stylix-mode body {
      --background-color: ${color "base00"};
      --text-color: ${textColor};
      --link-color: ${linkColor};
      --link-hover-color: ${linkHoverColor};
      --card-background: color-mix(in srgb, ${color "base01"} 78%, transparent);
      --card-border: color-mix(in srgb, ${color "base03"} 62%, transparent);
      --terminal-bg: color-mix(in srgb, ${color "base01"} 88%, transparent);
      --terminal-text: ${textColor};
      --shadow-color: color-mix(in srgb, ${color "base00"} 70%, transparent);
      --link-background: color-mix(in srgb, ${color "base02"} 72%, transparent);
      --link-hover: color-mix(in srgb, ${color "base03"} 64%, transparent);
      --color-primary: ${color "base0D"};
      --color-warning: ${color "base0A"};
      --color-error: ${color "base08"};
      --color-success: ${color "base0B"};
      --color-version: ${color "base0B"};
      --font-family: ${cssMonoFontFamily}, ui-monospace, "Cascadia Code", "Fira Code", "Fira Mono", "Consolas", "Menlo", monospace;
      --monospace-font-family: ${cssMonoFontFamily}, ui-monospace, "Cascadia Code", "Fira Code", "Fira Mono", "Consolas", "Menlo", monospace;
      color-scheme: dark;
    }

    html.stylix-mode body {
      background: var(--background-color);
    }

    html.stylix-mode #theme-overlay-scanlines,
    html.stylix-mode #theme-overlay-texture {
      display: none;
    }
  '';

  localDefaultsJs = pkgs.writeText "startpage-local-defaults.js" ''
    (function () {
      window.STARTPAGE_STYLIX_BACKGROUND = "${stylixBackground}";
      window.STARTPAGE_HOSTNAME = ${builtins.toJSON validHostname};
      window.STARTPAGE_DEFAULT_SYNTAX_COLORS = {
        cmd: "${color "base0D"}",
        theme: "${color "base0E"}",
        search: "${color "base0A"}",
        version: "${color "base0B"}",
        url: "${color "base0C"}",
        unknown: "${color "base08"}"
      };

      const meta = document.getElementById("meta-theme-color");
      if (meta) meta.setAttribute("content", window.STARTPAGE_STYLIX_BACKGROUND);

      if (!localStorage.getItem("syntaxColors") && typeof applySyntaxColors === "function") {
        applySyntaxColors(window.STARTPAGE_DEFAULT_SYNTAX_COLORS);
      }
    })();
  '';
in
  pkgs.runCommand "stylix-terminal-startpage" {nativeBuildInputs = [pkgs.gawk];} ''
      mkdir -p "$out"

      cp ${source}/style.css "$out/style.css"
      cp -R ${source}/icon "$out/icon"
      cp -R ${source}/img "$out/img"
      cp -R ${source}/script "$out/script"
      cp -R ${source}/version "$out/version"
      chmod -R u+w "$out/script"

      mkdir -p "$out/focus"
      cp ${source}/focus/focus.html "$out/focus/focus.html"
      sed 's|__STYLIX_BACKGROUND__|${stylixBackground}|g' \
        ${source}/focus/focus.js > "$out/focus/focus.js"

      awk -v base_css_style="${baseCssStyle}" '
        /<link rel="stylesheet" href="style[.]css"/ {
          while ((getline line < base_css_style) > 0) {
            print line
          }
          close(base_css_style)
          next
        }
        { print }
      ' ${source}/index.html | sed \
        -e 's#<script src="script/storage.js"></script>#<script src="script/storage.js"></script>\
    <script src="script/local-defaults.js?v=${cacheKey}"></script>#' \
        > "$out/index.html"

      cp ${stylixCss} "$out/stylix.css"
      cp ${localDefaultsJs} "$out/script/local-defaults.js"
  ''
