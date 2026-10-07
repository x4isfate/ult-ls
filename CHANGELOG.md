# Changelog

## 1.4.2 — documentation fixes

### Fixed
- Documentation: corrected the progress description and the archive name in the Russian install guide.

## 1.4.1 — sound fix

### Fixed
- **Sound**: browsers only allow sound after a click, tap or key press — a browser rule that no module can bypass, and one Foundry's own audio also follows. While playback is blocked, the loading screen now shows a small "Click anywhere to turn the sound on" hint, and the sound starts with the first click instead of leaving people guessing why it is silent.
- **Sound**: on touch screens the very first tap now starts the sound; it used to need a second one.

## 1.4.0 — the Hub update

**Module id changed to `ult-ls`.** Earlier releases used `ult-ld`. Install this version, and settings saved by the old copy are carried over automatically the first time the Game Master enters a world; then disable or remove the old `ult-ld` copy.

### Added
- **The Hub**: one settings window with tabs, search and a live preview, replacing the long settings list.
- **Five themes** — Idaris (default), Monochrome, Fantasy, Dark Fantasy, Sci-Fi. A theme sets the colours, both font groups and the progress style in one click.
- **Typography**: separate settings for the main text and for the tips — family (picked from the fonts Foundry already has), size, weight, italics.
- **Icon**: size, X/Y offset, endless rotation and pulse, each with its own speed.
- **Fifth progress style**: a dashed trail with a travelling spark, plus a comet-tail length setting that only shows for that style.
- **Tips**: 25 atmospheric lines and 15 Foundry tips, added four random ones at a time; an editor with a separate display time for each tip and one button to set the same time for all.
- **Tip position** now uses the same seven screen zones as the progress element; when both share a zone they merge into one box.
- **Sound**: your own audio file with volume, fade-in, fade-out and looping; a test button in the Hub.
- **Presets**: export all settings and tips to a file (or the clipboard), import them back with a summary first, or reset to defaults.
- **Personal theme**: if the Game Master allows it, each player can choose their own colours, fonts, progress style and icon for their own loading screen.
- **What's new** window after an update, with a "don't show until the next update" button.
- Loading stage captions now vary between a few phrasings.
- Translations: English, Russian, German.

### Fixed
- The toolbox buttons now work in Foundry 13 and 14 (they were written for the older control format).
- Simple mode is reachable by players, not only the GM.
- The slow-scene loading screen works after joining a world with the loading screen, not only when the first one was skipped.
- Icon rotation, pulse and offset settings now have an effect.
- Tips are italic by default, as the setting describes.
- A tip placed above the bar in a merged box now has its divider on the correct side.
- A failed start can no longer leave the interface blocked.
- Colour and slider changes save once when released instead of on every pixel of movement.
- Font list uses the current Foundry API location.
- Background image paths are escaped before being placed in CSS.

## 1.3.x
- Hub introduced; five progress styles; per-scene targeting; slow-scene loading screen.

## 1.0 – 1.2
- Initial releases: simulated progress synchronized with world loading, GM/player visibility, palette, background image, icon, lore tips, conflict detection.
