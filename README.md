# ULT's Loading Screen

A customizable cinematic loading screen for [Foundry VTT](https://foundryvtt.com) that replaces the default loading overlay with a simulated progress display synchronized to real world loading. Built for visuals and atmosphere first: nearly every detail can be changed, all from one settings window with a live preview.

- **Module id:** `ult-ls`
- **Author:** 4isfate
- **License:** MIT
- **Compatibility:** Foundry VTT v13–v14 (verified on v14, build 368)

## Install

In Foundry: **Add-on Modules → Install Module**, paste this into **Manifest URL**, and press Install:

```
https://github.com/x4isfate/ult-ls/releases/latest/download/module.json
```

After that, updates arrive through the normal **Update** button in Foundry. A step-by-step guide in Russian is in [INSTALL-RU.md](INSTALL-RU.md).

> **Coming from an older `ult-ld` copy?** The module id changed to `ult-ls`. Install this version, enter your world as Game Master once (your old settings are copied automatically), then disable or remove the old `ult-ld` copy.

## Features

**Progress**
- Simulated progress that tracks real world loading and never runs ahead of it, held at 90–99% until the world is genuinely ready
- Five progress styles: linear bar, segmented blocks, circular ring, row of dots, dashed trail with a travelling spark
- Seven screen zones for the progress element, with an optional frame
- Configurable minimum and maximum on-screen time, final hold and safety timeout
- Stage captions that vary between a few phrasings

**Look**
- Five themes — Idaris, Monochrome, Fantasy, Dark Fantasy, Sci-Fi — setting colours, fonts and progress style in one click
- Every colour, font, size, weight and italic setting available separately for the main text and for the tips
- Custom background image with dimming; Font Awesome or custom image icon with size, offset, endless rotation and pulse
- Optional loading sound with volume, fade-in and fade-out

**Tips**
- Your own lore and game tips, each with its own display time (or one time for all)
- 25 atmospheric lines and 15 Foundry tips to add four random ones at a time
- Tips share the progress element's seven screen zones and merge into one box when they overlap

**Control**
- Separate switches for the Game Master and for players
- Optional per-scene targeting, and a loading screen for genuinely slow scenes even when the scene filter hides it
- Personal player themes, if the Game Master allows them
- Simple mode (no animation, blur or glow) for weak devices, available to every player
- Preset export and import, reset to defaults, and a "what's new" window after updates
- Conflict detection against other loading-screen modules
- English, Russian and German

## Reporting bugs

Found something broken or have an idea? Please open an issue: <https://github.com/x4isfate/ult-ls/issues>

## API

```js
const api = game.modules.get("ult-ls").api;
api.show();        // show the overlay again
api.bump(75);      // raise the progress ceiling (0–99 before the world is ready)
api.ready();       // mark the world as ready
api.openHub();     // open the settings Hub (GM) or the personal theme window (players)
api.instance;      // the active overlay, or null
```

## License

[MIT](LICENSE) © 2026 4isfate
