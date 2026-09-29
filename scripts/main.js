/**
 * ULT's Loading Screen — entry point and hook wiring.
 *
 * Lifecycle:
 *
 *   init        settings and the two menu buttons are registered. `game.user`
 *               is still a placeholder, so nothing user-dependent happens here.
 *   setup       the real User exists. Visibility and the scene filter are
 *               decided, and the main overlay starts.
 *   canvasInit  a scene begins drawing. On later scene changes this arms a
 *               transient overlay, in case the canvas turns out to be slow.
 *   canvasReady the scene finished drawing. The transient overlay is dismissed.
 *   ready       the world is playable. The main overlay is allowed to complete,
 *               then the one-time housekeeping runs (legacy-id warning and
 *               settings migration, "what's new" window) for the GM.
 *
 * All settings editing happens in hub.js: the full Hub for the GM, and a
 * reduced personal-theme window for players when the GM allows it.
 */

import {
  MODULE_ID,
  getConfig,
  getSetting,
  setSetting,
  resolveIsGM,
  resolveCurrentSceneId,
  sceneName,
  checkSceneFilter,
  getSceneIds,
  findConflicts,
  findActiveLegacyCopy,
  migrateLegacySettings,
  playerThemeAllowed,
  registerSettings
} from "./settings.js";
import { LoadingOverlay } from "./loading-screen.js";
import { LoadingScreenHub, LoadingScreenPersonalHub } from "./hub.js";
import { maybeShowChangelog } from "./changelog.js";

/** Milestone values reported by each lifecycle hook. */
const MILESTONES = {
  setup: 32,
  canvasReady: 88,
  ready: 100
};

/** True once the world-join overlay has been started for this page load. */
let mainStarted = false;

/** Timer for the "the canvas is taking ages" fallback. */
let slowSceneTimer = null;

/** The transient overlay shown for a slow canvas, if any. */
let slowSceneOverlay = null;

function log(...args) {
  if (getSetting("debug")) console.log(`${MODULE_ID} |`, ...args);
}

/* -------------------------------------------------------------------------- */
/*  Visibility                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Decide whether the overlay may run for this client, and warn about module
 * conflicts once. Only ever called after `setup`.
 */
function shouldRun(isGM, cfg) {
  if (isGM && !cfg.enabledGM) return { run: false, reason: "disabled for GM" };
  if (!isGM && !cfg.enabledPlayers) return { run: false, reason: "disabled for players" };

  const conflicts = findConflicts(cfg);
  if (conflicts.length > 0) {
    const names = conflicts.map((c) => c.title).join(", ");
    console.warn(`${MODULE_ID} | loading screen conflict:`, conflicts.map((c) => c.id));

    if (cfg.conflictAction === "disable") {
      if (isGM) {
        ui.notifications?.warn(
          game.i18n.format("ULTLS.Notify.ConflictDisabled", { modules: names }),
          { permanent: true }
        );
      }
      return { run: false, reason: `disabled by conflict: ${names}` };
    }

    if (cfg.conflictAction === "notify" && isGM) {
      ui.notifications?.warn(game.i18n.format("ULTLS.Notify.Conflict", { modules: names }), {
        permanent: true
      });
    }
  }

  return { run: true };
}

/* -------------------------------------------------------------------------- */
/*  Scene controls buttons                                                    */
/* -------------------------------------------------------------------------- */

/** Flip this client's simple mode and update whatever is on screen right now. */
async function toggleSimpleMode() {
  const next = !getSetting("simpleMode");
  await setSetting("simpleMode", next);
  document.getElementById("ultls-overlay")?.setAttribute("data-simple", String(next));
  ui.notifications?.info(game.i18n.localize(next ? "ULTLS.Notify.SimpleOn" : "ULTLS.Notify.SimpleOff"));

  // The tool's title and icon reflect the state, so ask core to rebuild the
  // controls. Purely cosmetic: a failure here only leaves the tooltip stale.
  try {
    await ui.controls?.initialize?.();
  } catch (err) {
    /* nothing to do */
  }
}

/**
 * Add this module's buttons to the token controls.
 *
 * Since v13 `controls` is an object keyed by control name (the token controls
 * are `controls.tokens`) and each control's `tools` is an object keyed by tool
 * name; a button tool reacts through `onChange`. The hook runs again whenever
 * core rebuilds the controls, so this must be — and is — idempotent: it just
 * overwrites the same two keys.
 *
 *   - Simple mode: visible to everyone, because it is a personal, client-side
 *     setting meant for whoever is on a weak machine or connection.
 *   - Settings: the full Hub for the GM, the personal theme window for players
 *     (only while the GM allows it).
 */
function registerToolboxButtons(controls) {
  if (!controls || typeof controls !== "object") return;

  const group =
    controls.tokens ??
    controls.token ??
    Object.values(controls).find((g) => g?.name === "tokens" || g?.name === "token");
  if (!group) return;

  group.tools ??= {};
  const nextOrder = Object.keys(group.tools).length + 1;

  const simple = Boolean(getSetting("simpleMode"));
  group.tools.ultlsSimpleMode = {
    name: "ultlsSimpleMode",
    title: game.i18n.localize(simple ? "ULTLS.Toolbox.DisableSimple" : "ULTLS.Toolbox.EnableSimple"),
    icon: simple ? "fa-solid fa-bolt" : "fa-solid fa-gauge-simple-high",
    order: nextOrder,
    button: true,
    visible: true,
    onChange: () => toggleSimpleMode()
  };

  const isGM = Boolean(game.user?.isGM);
  const personal = !isGM && playerThemeAllowed();
  if (isGM || personal) {
    group.tools.ultlsSettings = {
      name: "ultlsSettings",
      title: game.i18n.localize(isGM ? "ULTLS.Toolbox.OpenHub" : "ULTLS.Toolbox.Personal"),
      icon: "fa-solid fa-hourglass-half",
      order: nextOrder + 1,
      button: true,
      visible: true,
      onChange: () => (isGM ? LoadingScreenHub.open() : LoadingScreenPersonalHub.open())
    };
  } else {
    delete group.tools.ultlsSettings;
  }
}

/* -------------------------------------------------------------------------- */
/*  Slow canvas fallback                                                      */
/* -------------------------------------------------------------------------- */

function clearSlowSceneTimer() {
  if (slowSceneTimer) {
    window.clearTimeout(slowSceneTimer);
    slowSceneTimer = null;
  }
}

/**
 * Arm the "this canvas is slow" fallback.
 *
 * The scene filter deliberately hides the overlay during normal play, but a
 * genuinely heavy map still means a real wait with nothing on screen. A timer
 * is armed here and cancelled in `canvasReady`: if the canvas finishes
 * quickly the user sees nothing at all, and if it drags on they get a loading
 * screen. The filter is ignored in that case, because the wait is real.
 *
 * "Something is already covering the screen" is decided by whether an overlay
 * exists right now, not by whether one ever ran: once the world-join overlay
 * has closed, later heavy scene changes must be able to show this again.
 */
function armSlowScene() {
  // A transient overlay can be closed by something other than canvasReady (the
  // safety timeout, or the world's own "ready"). Drop such a stale reference,
  // or it would silently block the next slow-scene overlay.
  if (slowSceneOverlay?.closed) slowSceneOverlay = null;

  if (LoadingOverlay.instance) return;
  if (!getSetting("slowSceneEnabled")) return;

  clearSlowSceneTimer();

  const threshold = Math.max(500, Number(getSetting("slowSceneMs")) || 2500);

  slowSceneTimer = window.setTimeout(() => {
    slowSceneTimer = null;
    if (LoadingOverlay.instance || (slowSceneOverlay && !slowSceneOverlay.closed)) return;

    const cfg = getConfig();
    const isGM = resolveIsGM();

    // Same audience rules as the main overlay.
    if (isGM && !cfg.enabledGM) return;
    if (!isGM && !cfg.enabledPlayers) return;

    log("canvas is slow, showing a transient overlay");
    try {
      slowSceneOverlay = LoadingOverlay.start(cfg, isGM, { transient: true });
    } catch (err) {
      console.warn(`${MODULE_ID} | could not show the slow-scene overlay`, err);
      slowSceneOverlay = null;
    }
  }, threshold);
}

function dismissSlowScene() {
  clearSlowSceneTimer();
  if (!slowSceneOverlay) return;

  const overlay = slowSceneOverlay;
  slowSceneOverlay = null;
  try {
    overlay.markReady();
  } catch (err) {
    console.warn(`${MODULE_ID} | could not close the transient overlay`, err);
    overlay.close();
  }
}

/* -------------------------------------------------------------------------- */
/*  After the world is ready                                                  */
/* -------------------------------------------------------------------------- */

/** Run `callback` once no overlay is on screen (or after a generous timeout). */
function afterOverlay(callback) {
  let tries = 0;
  const timer = window.setInterval(() => {
    tries++;
    if (!LoadingOverlay.instance || tries > 80) {
      window.clearInterval(timer);
      callback();
    }
  }, 500);
}

/**
 * GM-only housekeeping, each step isolated so one failure cannot stop the rest.
 */
async function runGMHousekeeping() {
  if (!game.user?.isGM) return;

  try {
    const legacyId = findActiveLegacyCopy();
    if (legacyId) {
      ui.notifications?.warn(game.i18n.format("ULTLS.Notify.LegacyActive", { id: legacyId }), { permanent: true });
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | legacy check failed`, err);
  }

  try {
    const copied = await migrateLegacySettings();
    if (copied > 0) {
      ui.notifications?.info(game.i18n.format("ULTLS.Notify.Migrated", { count: copied }), { permanent: true });
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | settings migration failed`, err);
  }

  afterOverlay(() => {
    try {
      maybeShowChangelog();
    } catch (err) {
      console.warn(`${MODULE_ID} | could not show the changelog`, err);
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  Hooks                                                                     */
/* -------------------------------------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();

  game.settings.registerMenu(MODULE_ID, "hub", {
    name: "ULTLS.Hub.MenuName",
    label: "ULTLS.Hub.MenuLabel",
    hint: "ULTLS.Hub.MenuHint",
    icon: "fa-solid fa-hourglass-half",
    type: LoadingScreenHub,
    restricted: true
  });

  // Not restricted: this is the players' window. It shows a short notice
  // instead of any controls while the GM has not allowed personal themes.
  game.settings.registerMenu(MODULE_ID, "personal", {
    name: "ULTLS.Personal.MenuName",
    label: "ULTLS.Personal.MenuLabel",
    hint: "ULTLS.Personal.MenuHint",
    icon: "fa-solid fa-palette",
    type: LoadingScreenPersonalHub,
    restricted: false
  });

  log("init: settings and menus registered");
});

Hooks.once("setup", () => {
  const cfg = getConfig();
  const isGM = resolveIsGM();

  const decision = shouldRun(isGM, cfg);
  if (!decision.run) {
    log("setup: not starting —", decision.reason);
    return;
  }

  const scene = checkSceneFilter(cfg);
  if (!scene.show) {
    log("setup: not starting —", scene.reason);
    log("setup: selected scenes:", getSceneIds(cfg).map(sceneName));
    return;
  }

  if (scene.reason) log("setup: scene filter note —", scene.reason);

  try {
    const overlay = LoadingOverlay.start(cfg, isGM);
    overlay?.bump(MILESTONES.setup);
    mainStarted = Boolean(overlay);
    log("setup: overlay started", { isGM, scene: resolveCurrentSceneId() });
  } catch (err) {
    console.error(`${MODULE_ID} | failed to start the loading overlay`, err);
    if (isGM) {
      ui.notifications?.error("ULT's Loading Screen failed to start — see the console (F12).");
    }
  }
});

// A scene is about to draw. Arm the fallback in case it is heavy.
Hooks.on("canvasInit", () => {
  try {
    armSlowScene();
  } catch (err) {
    console.warn(`${MODULE_ID} | slow-scene fallback failed to arm`, err);
  }
});

Hooks.on("canvasReady", () => {
  try {
    // Whatever happened, the wait is over.
    dismissSlowScene();
  } catch (err) {
    console.warn(`${MODULE_ID} | could not dismiss the transient overlay`, err);
  }

  // A no-op unless an overlay is currently on screen.
  if (mainStarted) LoadingOverlay.bump(MILESTONES.canvasReady);
});

Hooks.once("ready", () => {
  if (mainStarted) {
    LoadingOverlay.bump(MILESTONES.canvasReady);
    LoadingOverlay.bump(MILESTONES.ready);
    LoadingOverlay.markReady();
  }

  const mod = game.modules?.get?.(MODULE_ID);
  if (mod) {
    mod.api = {
      /** Show the overlay again, ignoring the scene filter. */
      show: () => {
        const overlay = LoadingOverlay.start(getConfig(), resolveIsGM());
        overlay?.markReady();
        return overlay;
      },
      /** Raise the progress ceiling, 0–99 before the world is ready. */
      bump: (value) => LoadingOverlay.bump(value),
      /** Mark the world ready so the progress completes and the overlay closes. */
      ready: () => LoadingOverlay.markReady(),
      /** Which scene the filter currently resolves to, for scripting and debugging. */
      currentScene: () => resolveCurrentSceneId(),
      /** Open the settings Hub (GM) or the personal theme window (players). */
      openHub: () => (game.user?.isGM ? LoadingScreenHub.open() : LoadingScreenPersonalHub.open()),
      get instance() {
        return LoadingOverlay.instance;
      }
    };
  }

  runGMHousekeeping();
});

Hooks.on("getSceneControlButtons", (controls) => {
  try {
    registerToolboxButtons(controls);
  } catch (err) {
    console.warn(`${MODULE_ID} | could not register the toolbox buttons`, err);
  }
});
