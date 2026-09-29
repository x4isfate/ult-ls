/**
 * ULT's Loading Screen — settings schema, registration and shared helpers.
 *
 * Every setting is described once in SCHEMA. registerSettings() reads it to
 * call game.settings.register(); the Hub window (hub.js) reads the same array
 * to build its UI; preset export/import and player overrides validate against
 * it too. One source of truth means a field can no longer exist in the code
 * but not in a language file, or be accepted from an imported file without the
 * same range/choice checks the UI applies.
 *
 * Almost every setting is registered with `config: false`: Foundry's own
 * settings list shows only menu buttons that open the Hub (GM) or the personal
 * theme window (players). All actual editing happens there.
 */

export const MODULE_ID = "ult-ls";

/** Earlier releases were published under this id; their settings are migrated once. */
export const LEGACY_MODULE_IDS = ["ult-ld"];

/** Generic roles at or above this value count as staff (3 = Assistant, 4 = GM). */
const STAFF_ROLE = 3;

/** Module ids known to take over the loading screen as well. */
export const KNOWN_CONFLICT_IDS = [
  "loading-screen",
  "loading-screen-system",
  "scene-loading-screens",
  "custom-loading-screen",
  "immersive-loading-screens",
  "foundryvtt-loading-screen"
];

/** Scene targeting modes. */
export const SCENE_MODES = ["all", "only", "except"];

/* -------------------------------------------------------------------------- */
/*  Themes                                                                    */
/* -------------------------------------------------------------------------- */

const NEUTRAL_TYPE = {
  primaryFontFamily: "",
  primaryFontSize: 100,
  primaryFontWeight: "default",
  primaryFontStyle: "default",
  tipsFontFamily: "",
  tipsFontSize: 100,
  tipsFontWeight: "default",
  tipsFontStyle: "default"
};

/**
 * Five named themes. A theme is a starting point: colours, the two font groups
 * and the progress style, all written into the same ordinary settings a GM can
 * keep tweaking afterwards. Each theme uses a different one of the five
 * progress styles, so all five are represented.
 *
 * "idaris" is the module's original look and is the default; it keeps the
 * default fonts so choosing it restores the classic appearance exactly.
 * Font families are ones Foundry ships with (Signika, Modesto Condensed,
 * Amiri); a family that is missing simply falls back to the module default.
 */
export const THEMES = {
  idaris: {
    ...NEUTRAL_TYPE,
    progressStyle: "bar",
    overlayBg: "#151a20", overlayBg2: "#0b0e12", barFill: "#5b87ab", barTrack: "#1e252d",
    border: "#3d5a75", primaryText: "#e4eaf0", accentText: "#8fa8c2", iconColor: "#a9c4dd", glowColor: "#456379"
  },
  monochrome: {
    ...NEUTRAL_TYPE,
    progressStyle: "segments",
    primaryFontFamily: "Signika", primaryFontSize: 95, primaryFontWeight: "normal",
    tipsFontFamily: "Signika", tipsFontStyle: "normal",
    overlayBg: "#101010", overlayBg2: "#050505", barFill: "#d8d8d8", barTrack: "#2a2a2a",
    border: "#555555", primaryText: "#f2f2f2", accentText: "#b0b0b0", iconColor: "#e0e0e0", glowColor: "#808080"
  },
  fantasy: {
    ...NEUTRAL_TYPE,
    progressStyle: "spinner",
    primaryFontFamily: "Modesto Condensed", primaryFontSize: 110,
    tipsFontFamily: "Amiri", tipsFontSize: 105, tipsFontStyle: "italic",
    overlayBg: "#2b2013", overlayBg2: "#16110a", barFill: "#c9a227", barTrack: "#3a2c17",
    border: "#7a5c2e", primaryText: "#f3e6c8", accentText: "#d8b463", iconColor: "#e8c877", glowColor: "#a5772e"
  },
  darkFantasy: {
    ...NEUTRAL_TYPE,
    progressStyle: "dots",
    primaryFontFamily: "Modesto Condensed", primaryFontSize: 115, primaryFontWeight: "bold",
    tipsFontFamily: "Amiri", tipsFontSize: 105, tipsFontStyle: "italic",
    overlayBg: "#1a0d0d", overlayBg2: "#0a0505", barFill: "#8b1e2b", barTrack: "#241010",
    border: "#5c1a1a", primaryText: "#e8d8d8", accentText: "#b56464", iconColor: "#c94f4f", glowColor: "#7a1f1f"
  },
  scifi: {
    ...NEUTRAL_TYPE,
    progressStyle: "trail",
    primaryFontFamily: "Signika", primaryFontSize: 90, primaryFontWeight: "bold",
    tipsFontFamily: "Signika", tipsFontSize: 95, tipsFontStyle: "normal",
    overlayBg: "#05141c", overlayBg2: "#020a0e", barFill: "#24d1ff", barTrack: "#0b2530",
    border: "#12678c", primaryText: "#d9f8ff", accentText: "#6fe3ff", iconColor: "#4de0ff", glowColor: "#0fb8e6"
  }
};

/** The settings a theme writes; used to know what "apply theme" touches. */
export function getThemeValues(id) {
  const theme = THEMES[id];
  return theme ? { ...theme } : null;
}

/* -------------------------------------------------------------------------- */
/*  Fonts                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Font families Foundry itself already offers: the built-in ones, anything
 * other modules registered in CONFIG.fontDefinitions, and fonts a GM added
 * through Foundry's Font Configuration.
 *
 * FontConfig moved namespaces in v13, so the current location is tried first
 * and the older ones only as a fallback; the deprecated global is touched last
 * because merely reading it can log a deprecation warning.
 */
export function getAvailableFontFamilies() {
  const found = new Set();
  const sources = [
    () => foundry?.applications?.settings?.menus?.FontConfig,
    () => foundry?.applications?.apps?.FontConfig,
    () => globalThis.FontConfig
  ];

  for (const source of sources) {
    try {
      const list = source()?.getAvailableFonts?.();
      if (Array.isArray(list) && list.length > 0) {
        for (const family of list) found.add(family);
        break;
      }
    } catch (err) {
      /* try the next location */
    }
  }

  try {
    for (const family of Object.keys(CONFIG?.fontDefinitions ?? {})) found.add(family);
  } catch (err) {
    /* CONFIG not ready */
  }

  return [...found]
    .filter((family) => typeof family === "string" && family.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));
}

/* -------------------------------------------------------------------------- */
/*  Positions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The seven screen zones shared by the progress element and the tips element.
 * Sharing one list is what makes "same position -> merge into one box" possible.
 */
export const POSITIONS = ["center", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"];

/** Tip position adds one value with no screen-zone equivalent: fully off. */
export const TIP_POSITIONS = [...POSITIONS, "hidden"];

/**
 * 1.3.x tips could be "below" / "above" / "screen-bottom" / "screen-top", none
 * of which exist in the unified vocabulary. Old saved values are mapped to the
 * closest equivalent so an existing world does not silently lose its setting.
 */
const LEGACY_TIP_POSITION_MAP = {
  below: "center",
  above: "center",
  "screen-bottom": "bottom",
  "screen-top": "top"
};

export function normalizeTipPosition(value) {
  if (TIP_POSITIONS.includes(value)) return value;
  return LEGACY_TIP_POSITION_MAP[value] ?? "center";
}

/** Shared 3-state choices for weight/style: "default" means "do not override". */
const FONT_WEIGHT_CHOICES = {
  default: "ULTLS.Settings.FontWeight.Default",
  normal: "ULTLS.Settings.FontWeight.Normal",
  bold: "ULTLS.Settings.FontWeight.Bold"
};

const FONT_STYLE_CHOICES = {
  default: "ULTLS.Settings.FontStyle.Default",
  normal: "ULTLS.Settings.FontStyle.Normal",
  italic: "ULTLS.Settings.FontStyle.Italic"
};

const POSITION_CHOICES = {
  center: "ULTLS.Settings.ProgressPosition.Center",
  top: "ULTLS.Settings.ProgressPosition.Top",
  bottom: "ULTLS.Settings.ProgressPosition.Bottom",
  "top-left": "ULTLS.Settings.ProgressPosition.TopLeft",
  "top-right": "ULTLS.Settings.ProgressPosition.TopRight",
  "bottom-left": "ULTLS.Settings.ProgressPosition.BottomLeft",
  "bottom-right": "ULTLS.Settings.ProgressPosition.BottomRight"
};

/* -------------------------------------------------------------------------- */
/*  Schema                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The schema. Each entry:
 *   key       setting id
 *   tab       which Hub tab it belongs to (purely a UI grouping, not stored)
 *   type      "boolean" | "number" | "select" | "text" | "color" | "path" | "font"
 *   scope     "world" | "client"
 *   reload    whether changing it needs a fresh world join to take effect
 *   i18n      localization key stem: ULTLS.Settings.<i18n>.Name / .Hint
 *   default   default value
 *   range     { min, max, step } — required for type "number"
 *   choices   { value: i18nKey, ... } — required for type "select"
 *   category  "image" | "audio" — required for type "path"
 *   advanced  true to keep it behind a "show advanced" toggle in the Hub
 *   showIf    (cfg) => boolean — hide the field unless it currently matters
 *   rebuild   true if changing it changes which fields are visible
 *   player    true if a player may override it in their personal theme
 */
export const SCHEMA = [
  // --- visibility --------------------------------------------------------
  { key: "enabledGM", tab: "visibility", type: "boolean", scope: "world", reload: true, i18n: "EnabledGM", default: true },
  { key: "enabledPlayers", tab: "visibility", type: "boolean", scope: "world", reload: true, i18n: "EnabledPlayers", default: true },
  { key: "allowPlayerTheme", tab: "visibility", type: "boolean", scope: "world", reload: false, i18n: "AllowPlayerTheme", default: false },
  { key: "simpleMode", tab: "visibility", type: "boolean", scope: "client", reload: false, i18n: "SimpleMode", default: false },
  { key: "debug", tab: "visibility", type: "boolean", scope: "client", reload: false, i18n: "Debug", default: false },

  // --- scenes --------------------------------------------------------------
  {
    key: "sceneMode", tab: "scenes", type: "select", scope: "world", reload: true, i18n: "SceneMode", default: "all",
    choices: { all: "ULTLS.Settings.SceneMode.All", only: "ULTLS.Settings.SceneMode.Only", except: "ULTLS.Settings.SceneMode.Except" }
  },
  { key: "slowSceneEnabled", tab: "scenes", type: "boolean", scope: "world", reload: true, i18n: "SlowSceneEnabled", default: true },
  { key: "slowSceneMs", tab: "scenes", type: "number", scope: "world", reload: true, i18n: "SlowScene", default: 2500, range: { min: 500, max: 30000, step: 250 } },

  // --- timing --------------------------------------------------------------
  { key: "minDurationMs", tab: "timing", type: "number", scope: "world", reload: true, i18n: "MinDuration", default: 4000, range: { min: 1000, max: 60000, step: 500 } },
  { key: "maxDurationMs", tab: "timing", type: "number", scope: "world", reload: true, i18n: "MaxDuration", default: 9000, range: { min: 1000, max: 120000, step: 500 } },
  // A single "final hold" replaces the old holdMinMs/holdMaxMs pair. The exact
  // wait is still randomised (+/-20%, see jitter() in loading-screen.js).
  { key: "holdMs", tab: "timing", type: "number", scope: "world", reload: true, i18n: "Hold", default: 2500, range: { min: 0, max: 20000, step: 250 } },
  { key: "safetyMs", tab: "timing", type: "number", scope: "world", reload: true, i18n: "Safety", default: 120000, range: { min: 0, max: 600000, step: 5000 } },
  { key: "tipIntervalMs", tab: "timing", type: "number", scope: "world", reload: true, i18n: "TipInterval", default: 6000, range: { min: 1500, max: 30000, step: 500 } },

  // --- layout ----------------------------------------------------------------
  {
    key: "progressStyle", tab: "layout", type: "select", scope: "world", reload: true, i18n: "ProgressStyle", default: "bar",
    rebuild: true, player: true,
    choices: {
      bar: "ULTLS.Settings.ProgressStyle.Bar",
      segments: "ULTLS.Settings.ProgressStyle.Segments",
      spinner: "ULTLS.Settings.ProgressStyle.Spinner",
      dots: "ULTLS.Settings.ProgressStyle.Dots",
      trail: "ULTLS.Settings.ProgressStyle.Trail"
    }
  },
  { key: "progressPosition", tab: "layout", type: "select", scope: "world", reload: true, i18n: "ProgressPosition", default: "center", choices: POSITION_CHOICES, player: true },
  {
    key: "tipPosition", tab: "layout", type: "select", scope: "world", reload: true, i18n: "TipPosition", default: "center",
    player: true,
    // Deliberately the same seven zones as progressPosition, plus "hidden".
    // When both resolve to the same zone the two elements merge into a single
    // box instead of drawing two overlapping ones — see buildOverlayDOM().
    choices: { ...POSITION_CHOICES, hidden: "ULTLS.Settings.TipPosition.Hidden" }
  },
  {
    key: "tipMergedOrder", tab: "layout", type: "select", scope: "world", reload: true, i18n: "TipMergedOrder", default: "below",
    player: true,
    choices: { below: "ULTLS.Settings.TipMergedOrder.Below", above: "ULTLS.Settings.TipMergedOrder.Above" }
  },
  { key: "showPanel", tab: "layout", type: "boolean", scope: "world", reload: true, i18n: "ShowPanel", default: true, player: true },
  { key: "edgePadding", tab: "layout", type: "number", scope: "world", reload: true, i18n: "EdgePadding", default: 6, range: { min: 0, max: 25, step: 1 }, player: true },
  { key: "barThickness", tab: "layout", type: "number", scope: "world", reload: true, i18n: "BarThickness", default: 16, range: { min: 6, max: 48, step: 1 }, player: true },
  // Only meaningful for the "trail" progress style, so hidden otherwise.
  {
    key: "trailCometLength", tab: "layout", type: "number", scope: "world", reload: true, i18n: "TrailCometLength",
    default: 40, range: { min: 10, max: 100, step: 5 }, player: true, showIf: (cfg) => cfg.progressStyle === "trail"
  },
  { key: "showPercent", tab: "layout", type: "boolean", scope: "world", reload: true, i18n: "ShowPercent", default: true, player: true },
  { key: "showStage", tab: "layout", type: "boolean", scope: "world", reload: true, i18n: "ShowStage", default: true, player: true },
  { key: "showTips", tab: "layout", type: "boolean", scope: "world", reload: true, i18n: "ShowTips", default: true, player: true },
  { key: "titleText", tab: "layout", type: "text", scope: "world", reload: true, i18n: "TitleText", default: "" },

  // --- typography ------------------------------------------------------------
  // Two groups, not one-per-element: title, stage and percentage read as a
  // single visual voice, so they share one font; tips get their own.
  { key: "primaryFontFamily", tab: "typography", type: "font", scope: "world", reload: true, i18n: "PrimaryFontFamily", default: "", player: true },
  { key: "primaryFontSize", tab: "typography", type: "number", scope: "world", reload: true, i18n: "PrimaryFontSize", default: 100, range: { min: 50, max: 200, step: 5 }, player: true },
  { key: "primaryFontWeight", tab: "typography", type: "select", scope: "world", reload: true, i18n: "PrimaryFontWeight", default: "default", choices: FONT_WEIGHT_CHOICES, player: true },
  { key: "primaryFontStyle", tab: "typography", type: "select", scope: "world", reload: true, i18n: "PrimaryFontStyle", default: "default", choices: FONT_STYLE_CHOICES, player: true },
  { key: "tipsFontFamily", tab: "typography", type: "font", scope: "world", reload: true, i18n: "TipsFontFamily", default: "", player: true },
  { key: "tipsFontSize", tab: "typography", type: "number", scope: "world", reload: true, i18n: "TipsFontSize", default: 100, range: { min: 50, max: 200, step: 5 }, player: true },
  { key: "tipsFontWeight", tab: "typography", type: "select", scope: "world", reload: true, i18n: "TipsFontWeight", default: "default", choices: FONT_WEIGHT_CHOICES, player: true },
  { key: "tipsFontStyle", tab: "typography", type: "select", scope: "world", reload: true, i18n: "TipsFontStyle", default: "default", choices: FONT_STYLE_CHOICES, player: true },

  // --- palette -----------------------------------------------------------
  // A one-click starting point. Picking a theme overwrites the colours, both
  // font groups and the progress style — that is the point of a theme — but
  // each of them stays a normal setting afterwards, free to nudge by hand.
  {
    key: "paletteTheme", tab: "palette", type: "select", scope: "world", reload: true, i18n: "PaletteTheme", default: "idaris",
    player: true,
    choices: {
      idaris: "ULTLS.Settings.PaletteTheme.Idaris",
      monochrome: "ULTLS.Settings.PaletteTheme.Monochrome",
      fantasy: "ULTLS.Settings.PaletteTheme.Fantasy",
      darkFantasy: "ULTLS.Settings.PaletteTheme.DarkFantasy",
      scifi: "ULTLS.Settings.PaletteTheme.SciFi"
    }
  },
  { key: "overlayBg", tab: "palette", type: "color", scope: "world", reload: true, i18n: "OverlayBg", default: "#151a20", player: true },
  { key: "overlayBg2", tab: "palette", type: "color", scope: "world", reload: true, i18n: "OverlayBg2", default: "#0b0e12", player: true },
  { key: "overlayOpacity", tab: "palette", type: "number", scope: "world", reload: true, i18n: "OverlayOpacity", default: 94, range: { min: 0, max: 100, step: 1 }, player: true },
  { key: "barFill", tab: "palette", type: "color", scope: "world", reload: true, i18n: "BarFill", default: "#5b87ab", player: true },
  { key: "barTrack", tab: "palette", type: "color", scope: "world", reload: true, i18n: "BarTrack", default: "#1e252d", player: true },
  { key: "border", tab: "palette", type: "color", scope: "world", reload: true, i18n: "Border", default: "#3d5a75", player: true },
  { key: "primaryText", tab: "palette", type: "color", scope: "world", reload: true, i18n: "PrimaryText", default: "#e4eaf0", player: true },
  { key: "accentText", tab: "palette", type: "color", scope: "world", reload: true, i18n: "AccentText", default: "#8fa8c2", player: true },
  { key: "iconColor", tab: "palette", type: "color", scope: "world", reload: true, i18n: "IconColor", default: "#a9c4dd", player: true },
  { key: "glowColor", tab: "palette", type: "color", scope: "world", reload: true, i18n: "GlowColor", default: "#456379", player: true },

  // --- media ---------------------------------------------------------------
  { key: "backgroundImage", tab: "media", type: "path", category: "image", scope: "world", reload: true, i18n: "BackgroundImage", default: "" },
  { key: "backgroundDim", tab: "media", type: "number", scope: "world", reload: true, i18n: "BackgroundDim", default: 35, range: { min: 0, max: 90, step: 5 }, player: true },
  {
    key: "iconMode", tab: "media", type: "select", scope: "world", reload: true, i18n: "IconMode", default: "auto",
    choices: {
      auto: "ULTLS.Settings.IconMode.Auto",
      fontawesome: "ULTLS.Settings.IconMode.FontAwesome",
      image: "ULTLS.Settings.IconMode.Image",
      none: "ULTLS.Settings.IconMode.None"
    }
  },
  { key: "iconFA", tab: "media", type: "text", scope: "world", reload: true, i18n: "IconFA", default: "fa-solid fa-dice-d20" },
  { key: "iconImage", tab: "media", type: "path", category: "image", scope: "world", reload: true, i18n: "IconImage", default: "" },
  // Icon animation. A flat percentage scale plus a pixel offset covers every
  // practical placement; rotation and pulse are toggles with their own speed
  // so the default look never needs four extra numbers.
  { key: "iconSize", tab: "media", type: "number", scope: "world", reload: true, i18n: "IconSize", default: 100, range: { min: 40, max: 250, step: 5 }, player: true },
  { key: "iconOffsetX", tab: "media", type: "number", scope: "world", reload: true, i18n: "IconOffsetX", default: 0, range: { min: -200, max: 200, step: 5 }, player: true },
  { key: "iconOffsetY", tab: "media", type: "number", scope: "world", reload: true, i18n: "IconOffsetY", default: 0, range: { min: -200, max: 200, step: 5 }, player: true },
  { key: "iconSpin", tab: "media", type: "boolean", scope: "world", reload: true, i18n: "IconSpin", default: false, player: true },
  { key: "iconSpinSpeed", tab: "media", type: "number", scope: "world", reload: true, i18n: "IconSpinSpeed", default: 6, range: { min: 1, max: 30, step: 1 }, player: true },
  { key: "iconPulse", tab: "media", type: "boolean", scope: "world", reload: true, i18n: "IconPulse", default: false, player: true },
  { key: "iconPulseSpeed", tab: "media", type: "number", scope: "world", reload: true, i18n: "IconPulseSpeed", default: 2, range: { min: 1, max: 10, step: 1 }, player: true },
  { key: "iconPulseAmount", tab: "media", type: "number", scope: "world", reload: true, i18n: "IconPulseAmount", default: 15, range: { min: 5, max: 50, step: 5 }, player: true },

  // --- sound ---------------------------------------------------------------
  // An empty path means "no sound": there is no separate on/off switch to
  // keep in sync with it. The other fields only appear once a file is chosen.
  { key: "soundPath", tab: "sound", type: "path", category: "audio", scope: "world", reload: true, i18n: "SoundPath", default: "", rebuild: true },
  { key: "soundVolume", tab: "sound", type: "number", scope: "world", reload: true, i18n: "SoundVolume", default: 80, range: { min: 0, max: 100, step: 5 }, player: true, showIf: (cfg) => Boolean(cfg.soundPath) },
  { key: "soundLoop", tab: "sound", type: "boolean", scope: "world", reload: true, i18n: "SoundLoop", default: true, showIf: (cfg) => Boolean(cfg.soundPath) },
  { key: "soundFadeInMs", tab: "sound", type: "number", scope: "world", reload: true, i18n: "SoundFadeIn", default: 1500, range: { min: 0, max: 10000, step: 100 }, showIf: (cfg) => Boolean(cfg.soundPath) },
  { key: "soundFadeOutMs", tab: "sound", type: "number", scope: "world", reload: true, i18n: "SoundFadeOut", default: 1500, range: { min: 0, max: 10000, step: 100 }, showIf: (cfg) => Boolean(cfg.soundPath) },

  // --- tips --------------------------------------------------------------
  {
    key: "tipOrder", tab: "tips", type: "select", scope: "world", reload: true, i18n: "TipOrder", default: "random",
    choices: { cycle: "ULTLS.Settings.TipOrder.Cycle", random: "ULTLS.Settings.TipOrder.Random" }
  },

  // --- conflicts -----------------------------------------------------------
  {
    key: "conflictAction", tab: "conflicts", type: "select", scope: "world", reload: true, i18n: "ConflictAction", default: "notify",
    choices: {
      notify: "ULTLS.Settings.ConflictAction.Notify",
      disable: "ULTLS.Settings.ConflictAction.Disable",
      ignore: "ULTLS.Settings.ConflictAction.Ignore"
    }
  },
  { key: "extraConflictIds", tab: "conflicts", type: "text", scope: "world", reload: true, i18n: "ExtraConflictIds", default: "", advanced: true }
];

/** Settings edited through bespoke Hub widgets rather than the generic schema renderer. */
export const CUSTOM_KEYS = {
  loreTips: { scope: "world", default: "" },
  sceneIds: { scope: "world", default: "" },
  playerOverrides: { scope: "client", default: "" },
  changelogSeen: { scope: "client", default: "" },
  legacyMigrated: { scope: "world", default: "" }
};

/** Convenience: schema entries for one Hub tab, in declared order. */
export function schemaForTab(tab) {
  return SCHEMA.filter((entry) => entry.tab === tab);
}

const SCHEMA_BY_KEY = new Map(SCHEMA.map((entry) => [entry.key, entry]));

export function schemaEntry(key) {
  return SCHEMA_BY_KEY.get(key) ?? null;
}

/** Flat map of key -> default, across both the schema and the custom keys. */
export const DEFAULTS = (() => {
  const map = {};
  for (const entry of SCHEMA) map[entry.key] = entry.default;
  for (const [key, entry] of Object.entries(CUSTOM_KEYS)) map[key] = entry.default;
  return map;
})();

/** Keys that make up the module's runtime configuration snapshot. */
const CONFIG_KEYS = [...SCHEMA.map((entry) => entry.key), "loreTips", "sceneIds"];

/* -------------------------------------------------------------------------- */
/*  Validation                                                                */
/* -------------------------------------------------------------------------- */

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Validate one value against its schema entry. Used for every value that does
 * not come straight from a Hub control: imported presets, a player's saved
 * overrides, and migrated legacy settings. Returns { ok, value }; a value that
 * fails is dropped rather than coerced into something surprising.
 */
export function sanitizeValue(entry, raw) {
  if (!entry) return { ok: false };

  switch (entry.type) {
    case "boolean":
      return typeof raw === "boolean" ? { ok: true, value: raw } : { ok: false };

    case "number": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false };
      const { min, max, step } = entry.range;
      let value = Math.min(max, Math.max(min, n));
      if (Number.isInteger(step)) value = Math.round(value);
      return { ok: true, value };
    }

    case "select":
      return typeof raw === "string" && Object.hasOwn(entry.choices, raw) ? { ok: true, value: raw } : { ok: false };

    case "color":
      return typeof raw === "string" && HEX_COLOR.test(raw.trim()) ? { ok: true, value: raw.trim().toLowerCase() } : { ok: false };

    case "font": {
      if (typeof raw !== "string") return { ok: false };
      // A font family ends up inside a CSS string, so only plain name
      // characters survive: no quotes, braces, semicolons or backslashes.
      const value = raw.replace(/[^\p{L}\p{N} _.\-]/gu, "").trim().slice(0, 80);
      return { ok: true, value };
    }

    case "path": {
      if (typeof raw !== "string") return { ok: false };
      const value = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 500);
      if (/^(javascript|vbscript|data:text|data:application)/i.test(value)) return { ok: false };
      return { ok: true, value };
    }

    case "text":
    default: {
      if (typeof raw !== "string") return { ok: false };
      let value = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      // Icon classes are applied via classList, so keep them to class-name characters.
      if (entry.key === "iconFA") value = value.replace(/[^a-z0-9 _-]/gi, "").replace(/\s+/g, " ");
      return { ok: true, value: value.slice(0, entry.key === "titleText" ? 120 : 300) };
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Tips                                                                      */
/* -------------------------------------------------------------------------- */

export const TIP_LIMITS = { count: 300, textLength: 600, minSec: 1.5, maxSec: 120 };

function cleanTipText(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, TIP_LIMITS.textLength);
}

function cleanTipSec(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(TIP_LIMITS.maxSec, Math.max(TIP_LIMITS.minSec, Math.round(n * 10) / 10));
}

/**
 * Parse the stored tips into `[{ text, sec }]`, `sec` being null when the tip
 * uses the default interval.
 *
 * Two formats are accepted. Since 1.4 the value is a JSON array of
 * `{ text, sec? }`. Earlier releases stored plain text, one tip per line;
 * that still reads correctly, so nothing needs migrating by hand.
 */
export function parseTips(raw) {
  const source = String(raw ?? "").trim();
  if (!source) return [];

  let items = null;
  if (source.startsWith("[")) {
    try {
      const parsed = JSON.parse(source);
      if (Array.isArray(parsed)) items = parsed;
    } catch (err) {
      /* not JSON after all: fall through to line mode */
    }
  }

  if (!items) items = source.split(/\r?\n/);

  const tips = [];
  for (const item of items) {
    const isObject = item !== null && typeof item === "object";
    const text = cleanTipText(isObject ? item.text : item);
    if (!text) continue;
    tips.push({ text, sec: isObject ? cleanTipSec(item.sec) : null });
    if (tips.length >= TIP_LIMITS.count) break;
  }
  return tips;
}

export function serializeTips(tips) {
  const clean = [];
  for (const tip of Array.isArray(tips) ? tips : []) {
    const text = cleanTipText(tip?.text);
    if (!text) continue;
    const sec = cleanTipSec(tip?.sec);
    clean.push(sec === null ? { text } : { text, sec });
    if (clean.length >= TIP_LIMITS.count) break;
  }
  return clean.length > 0 ? JSON.stringify(clean) : "";
}

/** Tips as the overlay consumes them: `[{ text, ms }]`, `ms` null = default interval. */
export function getTips(cfg) {
  return parseTips(cfg?.loreTips).map((tip) => ({ text: tip.text, ms: tip.sec === null ? null : Math.round(tip.sec * 1000) }));
}

/**
 * Seed tip content, offered as one-click "add a few" buttons in the Hub. Each
 * click adds a small random handful (default 4) that the list does not already
 * contain, so repeated clicks never produce duplicates. Keys are localized so
 * the inserted text matches the client's language.
 */
export const SEED_TIP_COUNTS = { atmospheric: 25, foundry: 15 };

export function getSeedTips(kind, count = 4, exclude = new Set()) {
  const total = SEED_TIP_COUNTS[kind] ?? 0;
  const stem = kind === "foundry" ? "Foundry" : "Atmospheric";
  const all = [];
  for (let i = 1; i <= total; i++) {
    const key = `ULTLS.SeedTips.${stem}.${String(i).padStart(2, "0")}`;
    const text = game.i18n.localize(key);
    if (text && text !== key && !exclude.has(text)) all.push(text);
  }
  // Fisher-Yates, then take the front. This is picking flavour text, not
  // anything that needs cryptographic randomness.
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.max(0, count));
}

/* -------------------------------------------------------------------------- */
/*  Reading and writing settings                                              */
/* -------------------------------------------------------------------------- */

/**
 * Safe single-setting read. Returns the default before settings are usable.
 * "tipPosition" is special-cased: a world that saved one of the 1.3.x values
 * still has that string on disk, and every reader should see the migrated
 * value transparently.
 */
export function getSetting(key) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    const resolved = value === undefined ? DEFAULTS[key] : value;
    return key === "tipPosition" ? normalizeTipPosition(resolved) : resolved;
  } catch (err) {
    return DEFAULTS[key];
  }
}

export async function setSetting(key, value) {
  try {
    return await game.settings.set(MODULE_ID, key, value);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not save setting`, key, err);
    return undefined;
  }
}

/**
 * Is the current client the Game Master?
 *
 * During `init` the `game.user` object is still a placeholder whose `isGM` is
 * false for everyone, including the GM. The authoritative record lives in the
 * initial server payload, which is present that early, so we fall back to it.
 */
export function resolveIsGM() {
  try {
    if (game.user?.id) return Boolean(game.user.isGM);
  } catch (err) {
    /* not ready yet */
  }

  try {
    const data = game.data ?? {};
    const userId = data.userId ?? data.user?._id ?? data.user?.id;
    const raw = data.users ?? [];
    const list = Array.isArray(raw) ? raw : Object.values(raw);
    const record = list.find((u) => (u._id ?? u.id) === userId);
    if (record?.role !== undefined) return Number(record.role) >= STAFF_ROLE;
  } catch (err) {
    /* nothing to fall back to */
  }

  return false;
}

/** World-level configuration exactly as the GM saved it. */
export function getWorldConfig() {
  const cfg = {};
  for (const key of CONFIG_KEYS) cfg[key] = getSetting(key);
  return cfg;
}

/* -------------------------------------------------------------------------- */
/*  Player overrides                                                          */
/* -------------------------------------------------------------------------- */

export function playerThemeAllowed() {
  return Boolean(getSetting("allowPlayerTheme"));
}

/** Keys a player may override in their personal theme. */
export function playerKeys() {
  return SCHEMA.filter((entry) => entry.player).map((entry) => entry.key);
}

/** Keep only allowed keys with valid values; anything else is silently dropped. */
export function sanitizeOverrides(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, raw] of Object.entries(input)) {
    const entry = SCHEMA_BY_KEY.get(key);
    if (!entry?.player) continue;
    const result = sanitizeValue(entry, raw);
    if (result.ok) out[key] = result.value;
  }
  return out;
}

/** The current player's saved overrides, validated on every read. */
export function getPlayerOverrides() {
  const raw = String(getSetting("playerOverrides") ?? "").trim();
  if (!raw) return {};
  try {
    return sanitizeOverrides(JSON.parse(raw));
  } catch (err) {
    return {};
  }
}

export async function savePlayerOverrides(overrides) {
  const clean = sanitizeOverrides(overrides);
  return setSetting("playerOverrides", Object.keys(clean).length > 0 ? JSON.stringify(clean) : "");
}

/**
 * Whole-config snapshot the overlay runs on: the world configuration, with a
 * non-GM player's personal overrides on top when the GM has allowed them.
 * The GM always sees the world configuration itself.
 */
export function getConfig() {
  const cfg = getWorldConfig();
  if (!resolveIsGM() && playerThemeAllowed()) Object.assign(cfg, getPlayerOverrides());
  return cfg;
}

/* -------------------------------------------------------------------------- */
/*  Presets: export / import                                                  */
/* -------------------------------------------------------------------------- */

export const PRESET_FORMAT = "ult-ls-preset";
export const PRESET_VERSION = 1;

/**
 * Not part of a preset: scene targeting depends on scene ids that differ from
 * world to world, and extra conflict ids are a technical setting of one install.
 * Client-scope settings (simple mode, debug) belong to a person, not a look.
 */
const PRESET_EXCLUDED = new Set(["sceneMode", "extraConflictIds"]);

function isPresetKey(entry) {
  return entry.scope === "world" && !PRESET_EXCLUDED.has(entry.key);
}

/** Build the plain object written to a preset file. */
export function buildPreset(cfg, moduleVersion = "") {
  const settings = {};
  for (const entry of SCHEMA) if (isPresetKey(entry)) settings[entry.key] = cfg[entry.key];
  return {
    format: PRESET_FORMAT,
    presetVersion: PRESET_VERSION,
    moduleVersion,
    exportedAt: new Date().toISOString(),
    settings,
    tips: parseTips(cfg.loreTips)
  };
}

/**
 * Read preset text. Never applies anything; returns what *would* be applied so
 * the Hub can show a summary first. Unknown keys and invalid values are
 * counted and skipped rather than trusted.
 */
export function parsePreset(text) {
  let data;
  try {
    data = JSON.parse(String(text ?? ""));
  } catch (err) {
    return { ok: false, error: "json" };
  }

  if (!data || typeof data !== "object" || data.format !== PRESET_FORMAT) {
    return { ok: false, error: "format" };
  }

  const incoming = data.settings && typeof data.settings === "object" ? data.settings : {};
  const values = {};
  let skipped = 0;

  for (const [key, raw] of Object.entries(incoming)) {
    const entry = SCHEMA_BY_KEY.get(key);
    if (!entry || !isPresetKey(entry)) {
      skipped++;
      continue;
    }
    const result = sanitizeValue(entry, raw);
    if (result.ok) values[key] = result.value;
    else skipped++;
  }

  let tips = null;
  if (Array.isArray(data.tips)) tips = parseTips(JSON.stringify(data.tips));

  return {
    ok: true,
    values,
    tips,
    applied: Object.keys(values).length + (tips ? 1 : 0),
    skipped,
    meta: {
      moduleVersion: typeof data.moduleVersion === "string" ? data.moduleVersion.slice(0, 20) : "",
      exportedAt: typeof data.exportedAt === "string" ? data.exportedAt.slice(0, 40) : ""
    }
  };
}

/**
 * Every setting the module has, back to its starting value: the whole schema
 * (world settings, scene targeting and this client's own switches alike) plus
 * the selected-scene list. Tips are content rather than a setting, so they are
 * not in here; the Hub clears them only when asked to.
 */
export function getAllDefaults() {
  const values = {};
  for (const entry of SCHEMA) values[entry.key] = entry.default;
  values.sceneIds = "";
  return values;
}

/* -------------------------------------------------------------------------- */
/*  Migration from the old module id                                          */
/* -------------------------------------------------------------------------- */

/**
 * World settings saved by an earlier release under the old module id. They are
 * read from the raw world payload, which holds every world setting whether or
 * not the module that owns it is active.
 */
export function collectLegacyValues() {
  const out = {};
  let records = [];
  try {
    records = game.data?.settings ?? [];
    if (!Array.isArray(records)) records = Object.values(records);
  } catch (err) {
    records = [];
  }

  for (const id of LEGACY_MODULE_IDS) {
    const prefix = `${id}.`;
    for (const record of records) {
      const fullKey = record?.key;
      if (typeof fullKey !== "string" || !fullKey.startsWith(prefix)) continue;
      let value = record.value;
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch (err) {
          /* already a plain string */
        }
      }
      out[fullKey.slice(prefix.length)] = value;
    }
  }
  return out;
}

/**
 * One-time copy of the old id's world settings into this module. Runs for the
 * GM only, and only once; every value is validated like an imported preset.
 * Returns the number of settings copied.
 */
export async function migrateLegacySettings() {
  if (getSetting("legacyMigrated")) return 0;

  const legacy = collectLegacyValues();
  let count = 0;

  for (const entry of SCHEMA) {
    if (entry.scope !== "world" || !Object.hasOwn(legacy, entry.key)) continue;
    let raw = legacy[entry.key];
    if (entry.key === "tipPosition") raw = normalizeTipPosition(raw);
    const result = sanitizeValue(entry, raw);
    if (!result.ok) continue;
    await setSetting(entry.key, result.value);
    count++;
  }

  if (typeof legacy.loreTips === "string" && legacy.loreTips.trim()) {
    const serialized = serializeTips(parseTips(legacy.loreTips));
    if (serialized) {
      await setSetting("loreTips", serialized);
      count++;
    }
  }

  if (typeof legacy.sceneIds === "string" && legacy.sceneIds.trim()) {
    await setSetting("sceneIds", legacy.sceneIds.slice(0, 5000));
    count++;
  }

  await setSetting("legacyMigrated", count > 0 ? "done" : "none");
  return count;
}

/** Is a copy of the module still installed and active under an old id? */
export function findActiveLegacyCopy() {
  for (const id of LEGACY_MODULE_IDS) {
    try {
      if (game.modules?.get?.(id)?.active) return id;
    } catch (err) {
      /* modules not ready */
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*  Scenes                                                                    */
/* -------------------------------------------------------------------------- */

export function splitList(value) {
  return String(value ?? "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Selected scene ids as an array. Accepts commas, spaces or newlines. */
export function getSceneIds(cfg) {
  return splitList(cfg?.sceneIds);
}

/**
 * Which scene is this client looking at right now?
 *
 * Resolved in order of specificity. `viewedScene` is the scene the user is
 * actually on; the world-level fallbacks cover a client that has never picked
 * a scene.
 */
export function resolveCurrentSceneId() {
  const candidates = [];

  try {
    if (game.user?.viewedScene) candidates.push(game.user.viewedScene);
    if (game.user?.lastViewedScene) candidates.push(game.user.lastViewedScene);
  } catch (err) {
    /* user not ready */
  }

  try {
    if (game.scenes?.current?.id) candidates.push(game.scenes.current.id);
    if (game.scenes?.active?.id) candidates.push(game.scenes.active.id);
    const initial = game.data?.scene?._id ?? game.data?.scene?.id;
    if (initial) candidates.push(initial);
  } catch (err) {
    /* scenes not ready */
  }

  return candidates.find((c) => typeof c === "string" && c.length > 0) ?? null;
}

/** Human-readable scene name, falling back to the id. */
export function sceneName(id) {
  if (!id) return "?";
  try {
    return game.scenes?.get?.(id)?.name ?? id;
  } catch (err) {
    return id;
  }
}

/**
 * Should the overlay be suppressed because of the scene filter?
 *
 * Modes: all (always show), only (only the listed scenes), except (everywhere
 * but the listed scenes). An empty list always shows, and an undeterminable
 * current scene fails open: a missed name is recoverable, a silently absent
 * loading screen is not.
 */
export function checkSceneFilter(cfg) {
  const mode = SCENE_MODES.includes(cfg?.sceneMode) ? cfg.sceneMode : "all";
  if (mode === "all") return { show: true };

  const ids = getSceneIds(cfg);
  if (ids.length === 0) {
    return { show: true, reason: "scene filter is active but the scene list is empty" };
  }

  const current = resolveCurrentSceneId();
  if (!current) {
    return { show: true, reason: "could not determine the current scene — showing anyway" };
  }

  const listed = ids.includes(current);

  if (mode === "only" && !listed) {
    return { show: false, reason: `current scene "${sceneName(current)}" is not in the selected list` };
  }
  if (mode === "except" && listed) {
    return { show: false, reason: `current scene "${sceneName(current)}" is excluded` };
  }

  return { show: true };
}

/* -------------------------------------------------------------------------- */
/*  Conflicts                                                                 */
/* -------------------------------------------------------------------------- */

/** Conflict ids: built-in list, plus extras, minus anything prefixed with "!". */
export function getConflictIds(cfg) {
  const tokens = splitList(cfg?.extraConflictIds);

  const removed = new Set(tokens.filter((t) => t.startsWith("!")).map((t) => t.slice(1)));
  const added = tokens.filter((t) => !t.startsWith("!"));

  const ids = KNOWN_CONFLICT_IDS.filter((id) => !removed.has(id));
  for (const id of added) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/** Active modules from the conflict list. */
export function findConflicts(cfg) {
  const found = [];
  for (const id of getConflictIds(cfg)) {
    const mod = game.modules?.get?.(id);
    if (mod?.active) found.push({ id, title: mod.title ?? id });
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/*  Registration                                                              */
/* -------------------------------------------------------------------------- */

export function registerSettings() {
  // Every schema entry is registered so the value persists and validates —
  // config:false just keeps it out of Foundry's own settings list.
  for (const entry of SCHEMA) {
    const options = {
      name: `ULTLS.Settings.${entry.i18n}.Name`,
      hint: `ULTLS.Settings.${entry.i18n}.Hint`,
      scope: entry.scope,
      config: false,
      default: entry.default,
      requiresReload: Boolean(entry.reload)
    };

    switch (entry.type) {
      case "boolean":
        options.type = Boolean;
        break;
      case "number":
        options.type = Number;
        options.range = entry.range;
        break;
      case "select":
        options.type = String;
        options.choices = Object.fromEntries(Object.keys(entry.choices).map((k) => [k, entry.choices[k]]));
        break;
      default:
        options.type = String;
        break;
    }

    game.settings.register(MODULE_ID, entry.key, options);
  }

  for (const [key, entry] of Object.entries(CUSTOM_KEYS)) {
    game.settings.register(MODULE_ID, key, {
      scope: entry.scope,
      config: false,
      type: String,
      default: entry.default
    });
  }
}
