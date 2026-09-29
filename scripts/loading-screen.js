/**
 * ULT's Loading Screen — the overlay, and the DOM builder it shares with the
 * Hub's live preview.
 *
 * Built with plain DOM, not ApplicationV2: ApplicationV2 renders only what its
 * PARTS declare, and a part without a real template file comes out empty —
 * which produced an invisible overlay with no console error in 1.0. Plain DOM
 * has no such failure mode.
 *
 * `buildOverlayDOM()` is the single place that constructs the visual tree. The
 * live LoadingOverlay class calls it and then starts timers on top; the Hub's
 * preview panel (hub.js) calls it directly and just paints one static frame.
 * Keeping construction in one function means the preview can never drift out
 * of sync with what players actually see.
 *
 * Backdrop layers, back to front: gradient -> image -> dim. The image sits
 * *above* the gradient; putting it underneath is what hid custom backgrounds
 * in 1.2.0.
 *
 * Every file path passes through resolvePath() before use. A picker returns a
 * path relative to the Foundry data root, but a browser resolves a relative
 * url() against the page URL, so a path like `_MAINDATA/bg.jpg` was requested
 * from the site root and 404'd silently. getRoute() adds the correct prefix.
 */

import { MODULE_ID, getTips, getSetting, normalizeTipPosition } from "./settings.js";
import { LoadingSound } from "./audio.js";

/** The bar may not exceed this before the world genuinely reports ready. */
const PRE_READY_CAP = 99;

const SEGMENT_COUNT = 28;
const DOT_COUNT = 18;

/**
 * Loading stages. `at` is the progress value at which the stage becomes
 * current, so the text never claims work the bar has not reached yet.
 */
/*
 * Each threshold now lists one or more localization keys; when there is more
 * than one, a single build() call (see #pickStageKeys) rolls one at random
 * per key list and keeps that choice for the lifetime of the overlay, so the
 * stage text never rewrites itself mid-loop. This is purely cosmetic
 * variation — there is deliberately no setting beyond the existing
 * show/hide toggle, matching how it behaved with one phrase per stage.
 */
const STAGES = [
  { at: 0, keys: ["ULTLS.Stage.Init"] },
  { at: 8, keys: ["ULTLS.Stage.World"] },
  { at: 20, keys: ["ULTLS.Stage.Data", "ULTLS.Stage.Data2"] },
  { at: 34, keys: ["ULTLS.Stage.Compendium"] },
  { at: 48, keys: ["ULTLS.Stage.Scene", "ULTLS.Stage.Scene2"] },
  { at: 62, keys: ["ULTLS.Stage.Textures", "ULTLS.Stage.Textures2"] },
  { at: 76, keys: ["ULTLS.Stage.Lighting", "ULTLS.Stage.Lighting2"] },
  { at: 88, keys: ["ULTLS.Stage.Interface", "ULTLS.Stage.Interface2"] },
  { at: 96, keys: ["ULTLS.Stage.Finalize", "ULTLS.Stage.Finalize2"] }
];

/** One random key per threshold, rolled once and reused for the overlay's life. */
function pickStageKeys() {
  return STAGES.map((stage) => stage.keys[Math.floor(Math.random() * stage.keys.length)]);
}

export function randInt(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

/**
 * Random value around `ms`, +/- `pct`. Used for the final hold: a single
 * number in settings, but never the exact same wait twice.
 */
export function jitter(ms, pct = 0.2) {
  const base = Math.max(0, Number(ms) || 0);
  if (base === 0) return 0;
  return randInt(Math.round(base * (1 - pct)), Math.round(base * (1 + pct)));
}

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function log(...args) {
  if (getSetting("debug")) console.log(`${MODULE_ID} |`, ...args);
}

function warn(...args) {
  console.warn(`${MODULE_ID} |`, ...args);
}

export function el(tag, className = null, attrs = {}, text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  if (text !== null) node.textContent = String(text);
  return node;
}

/**
 * Turn a picker path into a URL the browser can actually fetch.
 *
 * Foundry serves data files under a route prefix, which `foundry.utils.getRoute`
 * supplies. Absolute URLs and data URIs pass through untouched.
 */
export function resolvePath(path) {
  const value = String(path ?? "").trim();
  if (!value) return "";
  if (/^(https?:|data:|blob:)/i.test(value)) return value;

  try {
    const routed = foundry?.utils?.getRoute?.(value);
    if (routed) return String(routed);
  } catch (err) {
    /* fall through */
  }

  return value.startsWith("/") ? value : `/${value}`;
}

/**
 * Make a URL safe to place inside a CSS `url("...")` string: a quote, a
 * backslash or a line break would otherwise end the string early and turn the
 * value into invalid (or unintended) CSS.
 */
export function escapeCssUrl(url) {
  return String(url).replace(/["\\\n\r\f]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
}

/**
 * Load an image off-screen to confirm it resolves, and report what happened.
 * Silent failures were the reason a broken path looked like a broken module,
 * so the resolved URL is always reported — loudly on failure.
 */
function probeImage(url, label) {
  if (!url) return;
  const probe = new Image();
  probe.onload = () => log(`${label} loaded:`, url);
  probe.onerror = () =>
    warn(
      `${label} could NOT be loaded. Resolved URL: ${url}\n` +
        `Check that the file exists and that its folder is registered in File Sources.`
    );
  probe.src = url;
}

/**
 * The icon element, honouring the configured source.
 *
 * "auto" is the sensible default: use the image when one is supplied, fall
 * back to the Font Awesome glyph, and render nothing if neither is set. A
 * mismatch (image path set while the source is forced to Font Awesome) is
 * reported instead of silently ignored — that silent mismatch is why setting
 * an icon image appeared to do nothing in 1.2.0.
 */
function buildIconNode(cfg, { probe = true } = {}) {
  const { iconMode, iconFA, iconImage } = cfg;
  const hasImage = Boolean(String(iconImage ?? "").trim());
  const hasFA = Boolean(String(iconFA ?? "").trim());

  const imageNode = () => {
    const url = resolvePath(iconImage);
    if (probe) probeImage(url, "icon image");
    return el("img", null, { src: url, alt: "" });
  };

  const glyphNode = () => {
    if (!iconFA) return null;
    const i = document.createElement("i");
    for (const cls of String(iconFA).split(/\s+/).filter(Boolean)) i.classList.add(cls);
    return i;
  };

  if (iconMode === "none") return null;

  if (iconMode === "image") {
    if (!hasImage) {
      if (probe) warn('icon source is "custom image" but no image path is set — no icon will be shown');
      return null;
    }
    return imageNode();
  }

  if (iconMode === "fontawesome") {
    if (hasImage && probe) {
      warn(
        'an icon image path is set, but the icon source is "Font Awesome", so the image is ignored.\n' +
          'Switch "Icon source" to "Automatic" or "Custom image file" to use it.'
      );
    }
    return glyphNode();
  }

  // auto
  if (hasImage) return imageNode();
  if (hasFA) return glyphNode();
  if (probe) log("no icon configured — the icon area stays empty");
  return null;
}

/** Backdrop: gradient, then image above it, then a dimming pass. */
function buildScrim() {
  const scrim = el("div", "ultls-scrim", { "aria-hidden": "true" });
  scrim.appendChild(el("div", "ultls-scrim-bg"));
  scrim.appendChild(el("div", "ultls-scrim-image", { "data-ultls": "scrim-image" }));
  scrim.appendChild(el("div", "ultls-scrim-dim"));
  return scrim;
}

function buildProgress(cfg, refs) {
  const style = cfg.progressStyle;
  const wrap = el("div", "ultls-progress");

  if (style === "segments" || style === "dots") {
    const isDot = style === "dots";
    const holder = el("div", isDot ? "ultls-dots" : "ultls-segments");
    const count = isDot ? DOT_COUNT : SEGMENT_COUNT;
    for (let i = 0; i < count; i++) {
      const unit = el("span", isDot ? "ultls-dot" : "ultls-seg");
      holder.appendChild(unit);
      refs.units.push(unit);
    }
    wrap.appendChild(holder);
    return wrap;
  }

  if (style === "spinner") {
    const ringWrap = el("div", "ultls-ring-wrap");
    refs.ringEl = el("div", "ultls-ring", { "data-ultls": "ring" });
    ringWrap.appendChild(refs.ringEl);

    const center = el("div", "ultls-ring-center");
    if (cfg.showPercent) {
      refs.percentEl = el("span", "ultls-percent", { "data-ultls": "percent" }, "0%");
      center.appendChild(refs.percentEl);
    }
    ringWrap.appendChild(center);
    wrap.appendChild(ringWrap);
    return wrap;
  }

  if (style === "trail") {
    // A thin dashed line that lights up as it fills, with a glowing spark
    // riding the leading edge. `refs.fillEl` is still the element whose width
    // #paint() drives every tick -- the exact same contract the "bar" style
    // uses below -- so nothing about the engine needed to change for a new
    // visual style to exist.
    const track = el("div", "ultls-trail-track");
    refs.fillEl = el("div", "ultls-trail-fill", { "data-ultls": "fill" });
    track.appendChild(refs.fillEl);
    wrap.appendChild(track);
    return wrap;
  }

  const track = el("div", "ultls-bar-track");
  refs.fillEl = el("div", "ultls-bar-fill", { "data-ultls": "fill" });
  track.appendChild(refs.fillEl);
  track.appendChild(el("div", "ultls-bar-shine", { "aria-hidden": "true" }));
  wrap.appendChild(track);
  return wrap;
}

function makeTipNode() {
  return el("div", "ultls-tip", { "data-ultls": "tip" });
}

/**
 * Build the full overlay DOM tree for the given config.
 *
 * Returns `{ root, refs }`. `refs` holds direct references to the elements
 * the engine repaints every tick (fill, percent, stage, tip, ring, segment
 * units) so callers never have to re-query the DOM.
 *
 * @param {object} cfg
 * @param {object} [options]
 * @param {boolean} [options.isGM]
 * @param {boolean} [options.preview]  Marks the tree as a static Hub preview:
 *   no blocking, no probing broken paths a second time, `data-preview="true"`
 *   so the stylesheet can swap `position: fixed` for `position: absolute`.
 * @param {boolean} [options.hasTips]  Whether tips should be built at all —
 *   the caller already knows if the tip list is empty.
 */
export function buildOverlayDOM(cfg, options = {}) {
  const { isGM = false, preview = false, hasTips = true } = options;
  const refs = { units: [], fillEl: null, ringEl: null, percentEl: null, stageEl: null, tipEl: null };

  const root = el("div", "ultls-overlay", preview ? {} : { id: "ultls-overlay" });
  root.dataset.style = cfg.progressStyle;
  root.dataset.pos = cfg.progressPosition;
  root.dataset.panel = String(Boolean(cfg.showPanel));
  if (preview) root.dataset.preview = "true";

  root.appendChild(buildScrim());

  const panel = el("div", "ultls-panel", { "data-ultls": "panel" });
  panel.appendChild(el("div", "ultls-glow", { "aria-hidden": "true" }));

  const iconNode = buildIconNode(cfg, { probe: !preview });
  if (iconNode) {
    // Three nested layers, each owning exactly one transform source: outer
    // (static size/offset from settings, never animated), pulse (breathing
    // scale), spin (rotation, wraps the actual glyph/img). Nesting lets spin
    // and pulse run simultaneously without one animation's `transform`
    // overwriting the other's.
    const icon = el("div", "ultls-icon", { "aria-hidden": "true" });
    const pulseWrap = el("div", "ultls-icon-pulse");
    const spinWrap = el("div", "ultls-icon-spin");
    spinWrap.appendChild(iconNode);
    pulseWrap.appendChild(spinWrap);
    icon.appendChild(pulseWrap);

    const iconScale = clamp(Number(cfg.iconSize) || 100, 40, 250) / 100;
    const offX = clamp(Number(cfg.iconOffsetX) || 0, -200, 200);
    const offY = clamp(Number(cfg.iconOffsetY) || 0, -200, 200);
    icon.style.setProperty("--ultls-icon-scale", String(iconScale));
    icon.style.setProperty("--ultls-icon-offset-x", `${offX}px`);
    icon.style.setProperty("--ultls-icon-offset-y", `${offY}px`);

    if (cfg.iconSpin) {
      spinWrap.dataset.spin = "true";
      spinWrap.style.setProperty("--ultls-icon-spin-speed", `${clamp(Number(cfg.iconSpinSpeed) || 6, 1, 30)}s`);
    }
    if (cfg.iconPulse) {
      pulseWrap.dataset.pulse = "true";
      pulseWrap.style.setProperty("--ultls-icon-pulse-speed", `${clamp(Number(cfg.iconPulseSpeed) || 2, 1, 10)}s`);
      pulseWrap.style.setProperty(
        "--ultls-icon-pulse-amount",
        String(clamp(Number(cfg.iconPulseAmount) || 15, 5, 50) / 100)
      );
    }

    panel.appendChild(icon);
  }

  const title = String(cfg.titleText ?? "").trim();
  if (title) panel.appendChild(el("h1", "ultls-title", {}, title));

  // Tips share the progress element's seven-zone vocabulary (see POSITIONS in
  // settings.js). Same zone as the progress panel -> they merge into that one
  // panel, ordered by tipMergedOrder. Different zone -> the tip gets its own
  // fixed-position box elsewhere on screen (see [data-tip-pos] in
  // loading.css). "hidden" or no tips at all -> no tip node whatsoever.
  const tipZone = normalizeTipPosition(cfg.tipPosition);
  const showTips = Boolean(cfg.showTips && hasTips && tipZone !== "hidden");
  const tipsMerged = showTips && tipZone === cfg.progressPosition;
  const tipsSeparate = showTips && !tipsMerged;
  const mergedAbove = cfg.tipMergedOrder === "above";

  root.dataset.tipPos = tipZone;
  root.dataset.tipOrder = cfg.tipMergedOrder === "above" ? "above" : "below";

  if (tipsMerged && mergedAbove) {
    refs.tipEl = makeTipNode();
    panel.appendChild(refs.tipEl);
  }

  panel.appendChild(buildProgress(cfg, refs));

  const meta = el("div", "ultls-bar-meta");
  if (cfg.showStage) {
    refs.stageEl = el("span", "ultls-stage", { "data-ultls": "stage" }, "—");
    meta.appendChild(refs.stageEl);
  }
  // The ring draws its own percentage in the centre, so the meta copy is
  // omitted for that style to avoid showing the number twice.
  if (cfg.showPercent && cfg.progressStyle !== "spinner") {
    refs.percentEl = el("span", "ultls-percent", { "data-ultls": "percent" }, "0%");
    meta.appendChild(refs.percentEl);
  }
  if (meta.childElementCount > 0) panel.appendChild(meta);

  if (tipsMerged && !mergedAbove) {
    refs.tipEl = makeTipNode();
    panel.appendChild(refs.tipEl);
  }

  root.appendChild(panel);

  // A tip in a different zone than the progress panel lives outside it, in
  // its own fixed-position box, so it stays put regardless of where the
  // progress panel sits.
  if (tipsSeparate) {
    const tipBox = el("div", "ultls-tip-box", { "data-ultls": "tip-box" });
    refs.tipEl = makeTipNode();
    tipBox.appendChild(refs.tipEl);
    root.appendChild(tipBox);
  }

  applyOverlayStyles(root, cfg, { isGM, preview });

  return { root, refs };
}

/** Push every configured value into CSS custom properties on `root`. */
export function applyOverlayStyles(root, cfg, { isGM = false, preview = false } = {}) {
  const s = root.style;

  s.setProperty("--ultls-overlay-bg", cfg.overlayBg);
  s.setProperty("--ultls-overlay-bg2", cfg.overlayBg2);
  s.setProperty("--ultls-overlay-opacity", String(clamp(Number(cfg.overlayOpacity) || 0, 0, 100) / 100));
  s.setProperty("--ultls-bar-fill", cfg.barFill);
  s.setProperty("--ultls-bar-track", cfg.barTrack);
  s.setProperty("--ultls-border", cfg.border);
  s.setProperty("--ultls-text", cfg.primaryText);
  s.setProperty("--ultls-accent", cfg.accentText);
  s.setProperty("--ultls-icon-color", cfg.iconColor);
  s.setProperty("--ultls-glow", cfg.glowColor);
  s.setProperty("--ultls-edge", String(clamp(Number(cfg.edgePadding) || 0, 0, 25)));
  s.setProperty("--ultls-bar-thickness", `${clamp(Number(cfg.barThickness) || 16, 6, 48)}px`);
  s.setProperty("--ultls-trail-comet", `${clamp(Number(cfg.trailCometLength) || 40, 10, 100)}%`);
  s.setProperty("--ultls-dim", String(clamp(Number(cfg.backgroundDim) || 0, 0, 90) / 100));

  // Typography, in two groups (title/stage/percent share one "voice", tips
  // get their own). An empty family falls back to the module default stack
  // explicitly, rather than an empty string: an empty font-family value is
  // invalid CSS and drops the *entire* font-family list, not just that one
  // name, which would have silently reset every text element to the browser
  // default font instead of just leaving it alone.
  const primaryFamily = String(cfg.primaryFontFamily ?? "").trim();
  s.setProperty(
    "--ultls-font-primary",
    primaryFamily ? `"${primaryFamily}", "Signika", sans-serif` : `"Signika", sans-serif`
  );
  s.setProperty("--ultls-font-primary-size", String(clamp(Number(cfg.primaryFontSize) || 100, 50, 200) / 100));
  s.setProperty(
    "--ultls-font-primary-weight",
    cfg.primaryFontWeight === "bold" ? "700" : cfg.primaryFontWeight === "normal" ? "400" : "inherit"
  );
  s.setProperty(
    "--ultls-font-primary-style",
    cfg.primaryFontStyle === "italic" ? "italic" : cfg.primaryFontStyle === "normal" ? "normal" : "inherit"
  );

  const tipsFamily = String(cfg.tipsFontFamily ?? "").trim();
  s.setProperty(
    "--ultls-font-tips",
    tipsFamily ? `"${tipsFamily}", "Signika", sans-serif` : `"Signika", sans-serif`
  );
  s.setProperty("--ultls-font-tips-size", String(clamp(Number(cfg.tipsFontSize) || 100, 50, 200) / 100));
  s.setProperty(
    "--ultls-font-tips-weight",
    cfg.tipsFontWeight === "bold" ? "700" : cfg.tipsFontWeight === "normal" ? "400" : "inherit"
  );
  // Tips read as italic unless told otherwise, as the setting's own hint says:
  // "default" must resolve to italic, not to `inherit` (which would be upright
  // and make the stylesheet's italic fallback unreachable).
  s.setProperty("--ultls-font-tips-style", cfg.tipsFontStyle === "normal" ? "normal" : "italic");

  // The background goes on the layer as an inline style with a resolved
  // absolute URL, not as a CSS custom property: url() inside a custom
  // property resolves against the *consuming stylesheet*, which is what broke
  // every picker path in 1.2.0.
  const imageLayer = root.querySelector('[data-ultls="scrim-image"]');
  const raw = String(cfg.backgroundImage ?? "").trim();
  const url = resolvePath(raw);
  root.dataset.hasImage = url ? "true" : "false";

  if (imageLayer) imageLayer.style.backgroundImage = url ? `url("${escapeCssUrl(url)}")` : "";

  if (!preview) {
    if (url) {
      log("background resolved:", raw, "->", url);
      probeImage(url, "background image");
    } else {
      log("no background image configured (the setting is empty)");
    }
  }

  if (!preview && getSetting("simpleMode")) root.dataset.simple = "true";
  if (isGM) root.dataset.gm = "true";
}

export class LoadingOverlay {
  /** @type {LoadingOverlay|null} */
  static instance = null;

  /**
   * @param {object} cfg       Snapshot of the module settings.
   * @param {boolean} isGM     Whether this client is the Game Master.
   * @param {object} [options]
   * @param {boolean} [options.transient]
   *   Transient overlays cover a genuinely slow canvas during play rather than
   *   the world join. They keep the blocking behaviour but drop the simulated
   *   pacing entirely: no minimum duration, no hold. The overlay is already
   *   only on screen because the user is really waiting, so padding that wait
   *   would be a lie.
   */
  constructor(cfg, isGM = false, options = {}) {
    this.cfg = cfg;
    this.isGM = isGM;
    this.transient = Boolean(options.transient);

    this.startedAt = Date.now();
    this.totalMs = this.transient ? 1200 : Math.max(1, randInt(cfg.minDurationMs, cfg.maxDurationMs));
    this.holdMs = this.transient ? 0 : jitter(cfg.holdMs, 0.2);

    /** One randomly chosen localization key per stage threshold, fixed for this overlay's life. */
    this.stageKeys = pickStageKeys();

    /** Highest value the progress may currently show. */
    this.ceiling = 5;
    /** Value on screen, eased toward `ceiling * elapsedRatio`. */
    this.shown = 0;

    this.ready = false;
    this.finishing = false;
    this.closed = false;
    this.root = null;

    this.tips = getTips(cfg);
    this.tipIndex = -1;

    this.timers = { tick: null, tips: null, safety: null, close: null };
    this.blockers = null;

    /** Loading sound, if one is configured. Owned by this overlay, but outlives it while fading. */
    this.sound = null;
    /** The "click to turn the sound on" hint, present only while the browser is blocking playback. */
    this.soundHint = null;

    log("constructed", {
      style: cfg.progressStyle,
      position: cfg.progressPosition,
      tipPosition: cfg.tipPosition,
      iconMode: cfg.iconMode,
      bgSetting: cfg.backgroundImage || "(empty)",
      totalMs: this.totalMs,
      transient: this.transient
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Construction                                                      */
  /* ------------------------------------------------------------------ */

  #build() {
    const { root, refs } = buildOverlayDOM(this.cfg, {
      isGM: this.isGM,
      hasTips: this.tips.length > 0
    });
    Object.assign(this, refs);
    return root;
  }

  /* ------------------------------------------------------------------ */
  /*  Progress                                                          */
  /* ------------------------------------------------------------------ */

  /** Raise the ceiling. Called from Foundry lifecycle hooks. */
  bump(atLeast) {
    if (this.closed) return;
    const next = clamp(Number(atLeast) || 0, 0, PRE_READY_CAP);
    if (next > this.ceiling) {
      this.ceiling = next;
      log("ceiling raised to", next);
    }
  }

  /** The world is playable: allow 100% and schedule the exit. */
  markReady() {
    if (this.closed) return;
    this.ready = true;
    this.finishing = true;
    this.ceiling = 100;
    log("world marked ready");
    this.#scheduleClose();
  }

  #startEngine() {
    const tick = () => {
      if (this.closed) return;

      const elapsed = Date.now() - this.startedAt;
      const elapsedRatio = clamp(elapsed / this.totalMs, 0, 1);

      // Two independent drivers: the ceiling reflects real loading progress,
      // elapsed time reflects the simulated minimum. Their product means the
      // bar never outruns real loading, nor finishes before the minimum time.
      const wanted = this.ceiling * elapsedRatio;
      const gap = wanted - this.shown;
      const step = this.finishing ? Math.max(1.2, gap * 0.18) : Math.max(0.12, gap * 0.08);

      this.shown = clamp(this.shown + step, 0, this.ceiling);
      this.#paint();
      this.timers.tick = window.setTimeout(tick, 50);
    };

    this.timers.tick = window.setTimeout(tick, 50);

    if (this.tipEl && this.tips.length > 0) {
      this.#scheduleNextTip(true);
    }

    const safety = Number(this.cfg.safetyMs) || 0;
    if (safety > 0) {
      this.timers.safety = window.setTimeout(() => {
        if (this.closed) return;
        warn("safety timeout reached, closing forcibly");
        ui.notifications?.warn(game.i18n.localize("ULTLS.Notify.SafetyClosed"));
        this.close();
      }, safety);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Sound                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * Start the loading sound if a file is configured. A transient overlay (a
   * slow scene during play) stays silent: it is up for a moment and a sound
   * that starts and immediately fades would only be noise.
   */
  #startSound() {
    const path = String(this.cfg.soundPath ?? "").trim();
    if (!path || this.transient) return;

    const url = resolvePath(path);
    log("sound:", path, "->", url);
    this.sound = new LoadingSound({
      url,
      volume: this.cfg.soundVolume,
      loop: this.cfg.soundLoop,
      fadeInMs: this.cfg.soundFadeInMs,
      fadeOutMs: this.cfg.soundFadeOutMs,
      log: (message) => warn(message),
      onWaiting: () => this.#showSoundHint(),
      onPlaying: () => this.#hideSoundHint()
    });
    this.sound.start();
  }

  /**
   * Browsers do not allow sound before the person has clicked, tapped or pressed
   * a key on the page. While the sound is waiting for that, a small hint says so
   * — otherwise a silent loading screen just looks broken. It is only ever
   * shown when the browser actually refused playback.
   */
  #showSoundHint() {
    if (this.soundHint || !this.root || this.closed) return;

    const hint = el("div", "ultls-sound-hint", { role: "status" });
    hint.appendChild(el("i", "fa-solid fa-volume-high", { "aria-hidden": "true" }));
    hint.appendChild(el("span", null, {}, game.i18n.localize("ULTLS.Overlay.SoundHint")));
    this.root.appendChild(hint);
    this.soundHint = hint;
  }

  #hideSoundHint() {
    this.soundHint?.remove();
    this.soundHint = null;
  }

  /** Hand the sound over to its own fade-out; it keeps fading after the overlay is gone. */
  #endSound() {
    const sound = this.sound;
    this.sound = null;
    this.#hideSoundHint();
    sound?.fadeOutAndStop();
  }

  #paint() {
    if (!this.root) return;
    const shown = clamp(this.shown, 0, 100);
    const rounded = Math.round(shown);

    if (this.percentEl) this.percentEl.textContent = `${rounded}%`;

    if (this.stageEl) {
      let currentIdx = 0;
      for (let i = 0; i < STAGES.length; i++) if (rounded >= STAGES[i].at) currentIdx = i;
      const key = this.stageKeys[currentIdx];
      const text = game.i18n.localize(key);
      if (this.stageEl.textContent !== text) this.stageEl.textContent = text;
    }

    switch (this.cfg.progressStyle) {
      case "spinner":
        this.ringEl?.style.setProperty("--ultls-progress", String(shown));
        break;

      case "segments":
      case "dots": {
        const filled = Math.round((shown / 100) * this.units.length);
        this.units.forEach((unit, i) => unit.classList.toggle("is-on", i < filled));
        break;
      }

      default:
        if (this.fillEl) {
          this.fillEl.style.width = `${shown}%`;
          this.fillEl.classList.toggle("is-complete", rounded >= 100);
        }
    }
  }

  /**
   * Advance to the next tip and schedule the one after it.
   *
   * Each tip may carry its own display duration (set in the Hub's tip
   * editor); tips without one fall back to the global interval. Scheduling
   * is therefore per-tip rather than a single setInterval.
   */
  #scheduleNextTip(first) {
    if (this.closed || !this.tipEl || this.tips.length === 0) return;

    if (this.cfg.tipOrder === "random" && this.tips.length > 1) {
      let idx;
      do {
        idx = Math.floor(Math.random() * this.tips.length);
      } while (idx === this.tipIndex);
      this.tipIndex = idx;
    } else {
      this.tipIndex = (this.tipIndex + 1) % this.tips.length;
    }

    const entry = this.tips[this.tipIndex];
    const text = typeof entry === "string" ? entry : entry.text;
    const durationMs = (typeof entry === "object" && entry.ms > 0 ? entry.ms : null) ?? this.cfg.tipIntervalMs;

    const apply = () => {
      if (this.closed || !this.tipEl) return;
      this.tipEl.textContent = text;
      this.tipEl.classList.add("is-visible");
    };

    if (first) apply();
    else {
      this.tipEl.classList.remove("is-visible");
      window.setTimeout(apply, 350);
    }

    this.timers.tips = window.setTimeout(() => this.#scheduleNextTip(false), Math.max(500, durationMs));
  }

  /* ------------------------------------------------------------------ */
  /*  Interaction blocking                                              */
  /* ------------------------------------------------------------------ */

  #installBlockers() {
    const stop = (event) => {
      if (this.closed) return;
      if (event.target?.closest?.(".ultls-panel")) return;
      event.preventDefault();
      event.stopImmediatePropagation?.();
      event.stopPropagation?.();
      return false;
    };

    const opts = { capture: true, passive: false };
    const events = [
      "pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick",
      "auxclick", "contextmenu", "wheel", "touchstart", "touchend", "touchmove",
      "dragstart", "dragover", "drop"
    ];
    for (const type of events) document.addEventListener(type, stop, opts);

    // Escape hatches a stuck user needs: reload, dev-tools, and Escape for the GM.
    const onKey = (event) => {
      if (this.closed) return;
      const key = event.key;
      if (key === "F5" || key === "F12") return;
      if ((event.ctrlKey || event.metaKey) && ["r", "R"].includes(key)) return;
      if (key === "Escape" && this.isGM) return;
      event.preventDefault();
      event.stopImmediatePropagation?.();
    };
    document.addEventListener("keydown", onKey, true);

    this.blockers = { stop, onKey, opts, events };
    document.body.classList.add("ultls-blocking");
  }

  #removeBlockers() {
    if (!this.blockers) return;
    const { stop, onKey, opts, events } = this.blockers;
    for (const type of events) document.removeEventListener(type, stop, opts);
    document.removeEventListener("keydown", onKey, true);
    this.blockers = null;
    document.body.classList.remove("ultls-blocking");
    document.body.style.removeProperty("overflow");
  }

  /* ------------------------------------------------------------------ */
  /*  Closing                                                           */
  /* ------------------------------------------------------------------ */

  #scheduleClose() {
    // A transient overlay exists because the user is genuinely waiting, so it
    // must not pad that wait. It closes as soon as the canvas reports ready.
    if (this.transient) {
      log("closing immediately (transient)");
      this.timers.close = window.setTimeout(() => this.#fadeOut(), 150);
      return;
    }

    // Honour the configured minimum: if loading finished early, wait out the
    // remainder rather than flashing the screen away.
    const minimum = Number(this.cfg.minDurationMs) || 0;
    const remaining = Math.max(0, minimum - (Date.now() - this.startedAt));
    const wait = Math.max(remaining, this.holdMs);
    log("closing in", wait, "ms");
    this.timers.close = window.setTimeout(() => this.#fadeOut(), wait + 900);
  }

  async #fadeOut() {
    if (!this.root || this.closed) return this.close();

    // Transient overlays skip the fade: the scene is ready, so the sooner the
    // player sees it, the better.
    if (!this.transient) {
      this.root.dataset.closing = "true";
      this.#endSound();
      this.shown = 100;
      this.#paint();
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }

    return this.close();
  }

  close() {
    if (this.closed) return;
    this.closed = true;

    for (const key of Object.keys(this.timers)) {
      if (this.timers[key]) {
        window.clearTimeout(this.timers[key]);
        window.clearInterval(this.timers[key]);
        this.timers[key] = null;
      }
    }

    this.#endSound();
    this.#removeBlockers();
    const root = this.root ?? document.getElementById("ultls-overlay");
    root?.remove();

    this.root = null;
    if (LoadingOverlay.instance === this) LoadingOverlay.instance = null;
    log("closed");
  }

  /* ------------------------------------------------------------------ */
  /*  Entry point                                                       */
  /* ------------------------------------------------------------------ */

  static start(cfg, isGM, options = {}) {
    if (LoadingOverlay.instance) return LoadingOverlay.instance;

    if (isGM && !cfg.enabledGM) {
      log("skipped: disabled for GM");
      return null;
    }
    if (!isGM && !cfg.enabledPlayers) {
      log("skipped: disabled for players");
      return null;
    }

    const overlay = new LoadingOverlay(cfg, isGM, options);
    overlay.root = overlay.#build();
    document.body.appendChild(overlay.root);
    LoadingOverlay.instance = overlay;

    // The input blockers are installed first and are the one part that can
    // lock the whole page. If anything after them throws, close() must undo
    // them — otherwise a failed start would leave the UI frozen until F5.
    try {
      overlay.#installBlockers();
      overlay.#paint();
      overlay.#startEngine();
      overlay.#startSound();
    } catch (err) {
      overlay.close();
      throw err;
    }

    log("attached to body");
    return overlay;
  }

  static bump(atLeast) {
    LoadingOverlay.instance?.bump(atLeast);
  }

  static markReady() {
    LoadingOverlay.instance?.markReady();
  }
}
