/**
 * ULT's Loading Screen — the Hub.
 *
 * A single ApplicationV2 window that holds every setting, organised into tabs
 * down the left side, with a live preview above the settings. It exists in two
 * modes, both this class:
 *
 *   gm      the full Hub. Edits the world's settings (GM only).
 *   player  the personal theme window. Edits only a short whitelist of
 *           appearance settings (SCHEMA entries flagged `player`), stored on
 *           this client, and only while the GM has allowed it. It never writes
 *           a world setting: a player could not, and must not be able to.
 *
 * Design choices, and why:
 *
 *  - No HandlebarsApplicationMixin, no `static PARTS` templates. That mixin
 *    resolves templates before `_renderHTML`, and a part without a real
 *    template file fails silently — the failure mode that made 1.0 and 1.2
 *    do nothing with no error. Plain DOM cannot fail that way.
 *
 *  - No <form> submit. Each control writes its setting as it changes (sliders
 *    and colour pickers update the preview while dragging and save on release),
 *    the same way Foundry's own settings sheet behaves.
 *
 *  - The live preview calls the exact same `buildOverlayDOM()` the real overlay
 *    uses. A separate hand-built preview would inevitably drift from what
 *    players see; sharing the function makes that impossible.
 */

import {
  MODULE_ID,
  schemaForTab,
  schemaEntry,
  getWorldConfig,
  setSetting,
  parseTips,
  serializeTips,
  TIP_LIMITS,
  getSceneIds,
  resolveCurrentSceneId,
  resolveIsGM,
  getSeedTips,
  getThemeValues,
  getAvailableFontFamilies,
  getPlayerOverrides,
  savePlayerOverrides,
  playerThemeAllowed,
  buildPreset,
  parsePreset,
  getAllDefaults
} from "./settings.js";
import { buildOverlayDOM, el, resolvePath } from "./loading-screen.js";
import { LoadingSound } from "./audio.js";
import { maybeShowChangelog, installedVersion } from "./changelog.js";

const GITHUB_URL = "https://github.com/x4isfate/ult-ld";

/** Tabs, in the order they appear in the sidebar. */
const TABS = [
  { id: "home", icon: "fa-solid fa-house" },
  { id: "visibility", icon: "fa-solid fa-eye" },
  { id: "scenes", icon: "fa-solid fa-map" },
  { id: "timing", icon: "fa-solid fa-clock" },
  { id: "layout", icon: "fa-solid fa-table-cells-large" },
  { id: "typography", icon: "fa-solid fa-font" },
  { id: "palette", icon: "fa-solid fa-palette" },
  { id: "media", icon: "fa-solid fa-image" },
  { id: "sound", icon: "fa-solid fa-volume-high" },
  { id: "tips", icon: "fa-solid fa-comment-dots" },
  { id: "presets", icon: "fa-solid fa-floppy-disk" },
  { id: "conflicts", icon: "fa-solid fa-triangle-exclamation" }
];

/** The tabs a player sees in their personal window. */
const PLAYER_TABS = new Set(["home", "layout", "typography", "palette", "media", "sound"]);

const SAMPLE_STAGE_KEY = "ULTLS.Stage.Textures";

/** How many tips a "seed" button adds per click. */
const SEED_BATCH = 4;

function loc(key) {
  return game.i18n.localize(key);
}

function fmt(key, data) {
  return game.i18n.format(key, data);
}

/** A "?" hint icon whose native browser tooltip carries the setting's hint text. */
function hintIcon(text) {
  return el("i", "ultls-hint fa-solid fa-circle-question", { title: text, "aria-hidden": "true" });
}

/** A small button with an icon and a text label. */
function button(label, { icon = null, className = "ultls-btn", title = null } = {}) {
  const b = el("button", className, { type: "button", title });
  if (icon) b.appendChild(el("i", icon, { "aria-hidden": "true" }));
  if (label) b.appendChild(el("span", null, {}, label));
  return b;
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

/** Hand a text to the user as a downloaded file, without depending on any core helper. */
function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export class LoadingScreenHub extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "ultls-hub",
    classes: ["ultls-hub-app"],
    tag: "div",
    window: {
      title: "ULTLS.Hub.Title",
      icon: "fa-solid fa-hourglass-half",
      resizable: true
    },
    // Sized to show a good chunk of a settings panel without scrolling on a
    // typical 1080p display, while leaving room for the canvas behind it.
    position: { width: 960, height: 760 }
  };

  /** "gm" for the full Hub, "player" for the personal theme window. */
  static MODE = "gm";

  #soundTest = null;
  #tips = [];
  #tipsSaveTimer = null;
  #tipsListEl = null;
  #tipsCountEl = null;
  #resetTimer = null;

  constructor(options = {}) {
    super(options);
    this.mode = this.constructor.MODE;
    this.isPlayer = this.mode === "player";
    this.activeTab = "home";
    this.reloadPending = false;
    this.#loadState();
  }

  /* ------------------------------------------------------------------ */
  /*  State                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * In-memory mirror of every setting, updated instantly for the preview. In
   * player mode it is the world configuration with this player's overrides on
   * top, and writes go to the overrides only.
   */
  #loadState() {
    this.world = getWorldConfig();
    this.overrides = this.isPlayer ? getPlayerOverrides() : {};
    this.cfg = { ...this.world, ...this.overrides };
    this.#tips = parseTips(this.cfg.loreTips);
  }

  /** Can this window actually edit anything right now? */
  #usable() {
    if (!this.isPlayer) return true;
    return !resolveIsGM() && playerThemeAllowed();
  }

  #entryAllowed(entry) {
    return this.isPlayer ? Boolean(entry.player) : true;
  }

  #visibleTabs() {
    if (!this.#usable()) return TABS.filter((tab) => tab.id === "home");
    return this.isPlayer ? TABS.filter((tab) => PLAYER_TABS.has(tab.id)) : TABS;
  }

  /** Persist one value where this mode keeps it. `entry` may be a schema entry. */
  #store(entry, value) {
    this.cfg[entry.key] = value;

    // Client-scope settings (simple mode) are always this person's own.
    if (entry.scope === "client") {
      setSetting(entry.key, value);
      return;
    }
    if (this.isPlayer) {
      this.overrides[entry.key] = value;
      savePlayerOverrides(this.overrides);
      return;
    }
    setSetting(entry.key, value);
  }

  /** Persist several schema values at once, saving player overrides in one write. */
  #storeMany(values) {
    for (const [key, value] of Object.entries(values)) {
      const entry = schemaEntry(key);
      if (!entry || !this.#entryAllowed(entry)) continue;
      this.cfg[key] = value;
      if (entry.scope === "client") setSetting(key, value);
      else if (this.isPlayer) this.overrides[key] = value;
      else setSetting(key, value);
    }
    if (this.isPlayer) savePlayerOverrides(this.overrides);
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering                                                          */
  /* ------------------------------------------------------------------ */

  async _renderHTML() {
    const root = el("div", "ultls-hub");
    root.appendChild(this.#buildSidebar());
    root.appendChild(this.#buildContent());
    root.appendChild(this.#buildFooter());
    return root;
  }

  async _replaceHTML(result, content) {
    content.replaceChildren(result);
    this.#showTab(this.activeTab);
  }

  _onClose(options) {
    this.#stopSoundTest();
    window.clearTimeout(this.#tipsSaveTimer);
    window.clearTimeout(this.#resetTimer);
    return super._onClose?.(options);
  }

  /* ------------------------------------------------------------------ */
  /*  Sidebar                                                            */
  /* ------------------------------------------------------------------ */

  #buildSidebar() {
    const nav = el("nav", "ultls-hub-sidebar");

    const search = el("div", "ultls-hub-search");
    const input = el("input", null, { type: "text", placeholder: loc("ULTLS.Hub.Search") });
    input.addEventListener("input", () => this.#filterNav(input.value));
    search.append(el("i", "fa-solid fa-magnifying-glass", { "aria-hidden": "true" }), input);
    nav.appendChild(search);

    const list = el("div", "ultls-hub-nav-list");
    for (const tab of this.#visibleTabs()) {
      const btn = el("button", "ultls-hub-nav-btn", { type: "button", "data-tab": tab.id });
      btn.appendChild(el("i", tab.icon, { "aria-hidden": "true" }));
      btn.appendChild(el("span", null, {}, loc(`ULTLS.Hub.Tab.${tab.id}`)));
      btn.addEventListener("click", () => this.#showTab(tab.id));
      list.appendChild(btn);
    }
    nav.appendChild(list);

    return nav;
  }

  #filterNav(query) {
    const q = query.trim().toLowerCase();
    for (const btn of this.element?.querySelectorAll(".ultls-hub-nav-btn") ?? []) {
      btn.classList.toggle("is-hidden", q.length > 0 && !btn.textContent.toLowerCase().includes(q));
    }
  }

  #showTab(tabId) {
    this.activeTab = tabId;
    const root = this.element;
    if (!root) return;

    for (const btn of root.querySelectorAll(".ultls-hub-nav-btn")) {
      btn.classList.toggle("is-active", btn.dataset.tab === tabId);
    }
    for (const panel of root.querySelectorAll(".ultls-hub-panel")) {
      panel.classList.toggle("is-active", panel.dataset.tab === tabId);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Content                                                            */
  /* ------------------------------------------------------------------ */

  #buildContent() {
    const wrap = el("div", "ultls-hub-content");
    if (this.#usable()) wrap.appendChild(this.#buildPreview());

    const scroller = el("div", "ultls-hub-panels");
    scroller.replaceChildren(...this.#buildPanels());
    wrap.appendChild(scroller);
    return wrap;
  }

  #buildPanels() {
    return this.#visibleTabs().map((tab) => this.#panelFor(tab.id));
  }

  #panelFor(tabId) {
    switch (tabId) {
      case "home":
        return this.#buildHomePanel();
      case "scenes":
        return this.#buildScenesPanel();
      case "sound":
        return this.#buildSoundPanel();
      case "tips":
        return this.#buildTipsPanel();
      case "presets":
        return this.#buildPresetsPanel();
      default:
        return this.#buildSchemaPanel(tabId);
    }
  }

  #panel(id) {
    return el("section", "ultls-hub-panel", { "data-tab": id });
  }

  #sectionTitle(text) {
    return el("h2", "ultls-hub-panel-title", {}, text);
  }

  /** Replace one tab's panel in place (used when a change alters which fields exist). */
  #rebuildTab(tabId) {
    const root = this.element;
    const old = root?.querySelector(`.ultls-hub-panel[data-tab="${tabId}"]`);
    if (!old) return;
    const fresh = this.#panelFor(tabId);
    fresh.classList.toggle("is-active", this.activeTab === tabId);
    old.replaceWith(fresh);
  }

  /** Replace every panel (used after an import, reset, or "back to the GM's look"). */
  #rebuildAll() {
    const scroller = this.element?.querySelector(".ultls-hub-panels");
    if (!scroller) return;
    scroller.replaceChildren(...this.#buildPanels());
    this.#showTab(this.activeTab);
  }

  /* ------------------------------------------------------------------ */
  /*  Home                                                               */
  /* ------------------------------------------------------------------ */

  #buildHomePanel() {
    const panel = this.#panel("home");
    panel.appendChild(this.#sectionTitle(loc("ULTLS.Hub.Tab.home")));

    if (this.isPlayer) return this.#fillPlayerHome(panel);

    panel.appendChild(el("p", "ultls-hub-lead", {}, loc("ULTLS.Hub.Home.About")));
    panel.appendChild(el("p", "ultls-hub-lead", {}, loc("ULTLS.Hub.Home.Intro")));

    const meta = el("p", "ultls-hub-meta", {}, fmt("ULTLS.Hub.Home.Version", { version: installedVersion() || "?" }));
    panel.appendChild(meta);

    const actions = el("div", "ultls-row");
    const whatsNew = button(loc("ULTLS.Hub.Home.WhatsNew"), { icon: "fa-solid fa-scroll" });
    whatsNew.addEventListener("click", () => maybeShowChangelog({ force: true }));
    actions.appendChild(whatsNew);
    panel.appendChild(actions);

    panel.appendChild(el("p", "notes", {}, loc("ULTLS.Hub.Home.Hint")));

    // A reset is worth having where people look first, not only on the
    // Presets tab: the same control, so both behave identically.
    panel.appendChild(el("h3", "ultls-hub-subtitle", {}, loc("ULTLS.Hub.Presets.ResetTitle")));
    panel.appendChild(this.#buildResetRow());
    return panel;
  }

  #fillPlayerHome(panel) {
    // The GM edits the world's look in the full Hub; this window is for players.
    if (resolveIsGM()) {
      panel.appendChild(el("p", "ultls-notice", {}, loc("ULTLS.Personal.GMNotice")));
      return panel;
    }

    if (!playerThemeAllowed()) {
      panel.appendChild(el("p", "ultls-notice is-locked", {}, loc("ULTLS.Personal.NotAllowed")));
      return panel;
    }

    panel.appendChild(el("p", "ultls-hub-lead", {}, loc("ULTLS.Personal.Intro")));
    panel.appendChild(el("p", "ultls-notice", {}, loc("ULTLS.Personal.Allowed")));

    // Simple mode is personal too, and is the setting a player on a weak
    // machine is most likely to want, so it sits right here.
    const simple = schemaEntry("simpleMode");
    if (simple) panel.appendChild(this.#renderField(simple));

    const actions = el("div", "ultls-row");
    const reset = button(loc("ULTLS.Personal.Reset"), { icon: "fa-solid fa-rotate-left" });
    reset.addEventListener("click", () => this.#resetPlayer());
    actions.appendChild(reset);
    panel.appendChild(actions);

    panel.appendChild(el("p", "notes", {}, loc("ULTLS.Personal.Note")));
    return panel;
  }

  async #resetPlayer() {
    this.overrides = {};
    await savePlayerOverrides({});
    this.cfg = { ...this.world };
    this.#rebuildAll();
    this.#refreshPreview();
    ui.notifications?.info(loc("ULTLS.Personal.ResetDone"));
  }

  /* ------------------------------------------------------------------ */
  /*  Generic schema panel and controls                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Every SCHEMA entry for this tab (that this mode may edit), rendered by
   * its type. `showIf` hides a field that only matters given another field's
   * current value, evaluated against the live in-memory config.
   * Entries marked `advanced` sit under a collapsed toggle.
   */
  #buildSchemaPanel(tabId) {
    const panel = this.#panel(tabId);
    panel.appendChild(this.#sectionTitle(loc(`ULTLS.Hub.Tab.${tabId}`)));
    this.#appendSchemaFields(panel, tabId);
    return panel;
  }

  #appendSchemaFields(panel, tabId) {
    const entries = schemaForTab(tabId).filter((e) => this.#entryAllowed(e) && (!e.showIf || e.showIf(this.cfg)));
    const basic = entries.filter((e) => !e.advanced);
    const adv = entries.filter((e) => e.advanced);

    for (const entry of basic) panel.appendChild(this.#renderField(entry));

    if (adv.length > 0) {
      const details = el("details", "ultls-hub-advanced");
      details.appendChild(el("summary", null, {}, loc("ULTLS.Hub.AdvancedToggle")));
      for (const entry of adv) details.appendChild(this.#renderField(entry));
      panel.appendChild(details);
    }
  }

  /** One labelled control, wired to write straight through to the setting. */
  #renderField(entry) {
    const row = el("div", "ultls-field", { "data-key": entry.key });

    const label = el("div", "ultls-field-label");
    label.appendChild(el("span", null, {}, loc(`ULTLS.Settings.${entry.i18n}.Name`)));
    label.appendChild(hintIcon(loc(`ULTLS.Settings.${entry.i18n}.Hint`)));
    row.appendChild(label);

    row.appendChild(this.#buildControl(entry));
    return row;
  }

  #buildControl(entry) {
    const value = this.cfg[entry.key];

    switch (entry.type) {
      case "boolean":
        return this.#boolControl(entry, value);
      case "number":
        return this.#numberControl(entry, value);
      case "select":
        return this.#selectControl(entry, value);
      case "color":
        return this.#colorControl(entry, value);
      case "path":
        return this.#pathControl(entry, value);
      case "font":
        return this.#fontControl(entry, value);
      default:
        return this.#textControl(entry, value);
    }
  }

  /**
   * A control changed for good: persist it, apply side effects, refresh.
   * Dragging a slider or colour picker calls `#preview` instead and only the
   * final value comes through here.
   */
  #commit(entry, value) {
    this.#store(entry, value);

    if (entry.key === "paletteTheme") this.#applyTheme(value);
    if (entry.rebuild) this.#rebuildTab(entry.tab);

    if (entry.reload && !this.isPlayer) this.#flagReload();
    this.#refreshPreview();
  }

  /** Update the in-memory value and the preview only; nothing is saved yet. */
  #preview(entry, value) {
    this.cfg[entry.key] = value;
    this.#refreshPreview();
  }

  /**
   * A theme is a shortcut that writes the colours, both font groups and the
   * progress style at once. Every value goes through the same path a manual
   * edit takes, so nothing about them is special afterwards.
   */
  #applyTheme(id) {
    const values = getThemeValues(id);
    if (!values) return;
    this.#storeMany(values);
    for (const tabId of ["palette", "layout", "typography"]) this.#rebuildTab(tabId);
    if (!this.isPlayer) this.#flagReload();
  }

  #boolControl(entry, value) {
    const wrap = el("label", "ultls-toggle");
    const input = el("input", null, { type: "checkbox" });
    input.checked = Boolean(value);
    input.addEventListener("change", () => this.#commit(entry, input.checked));
    wrap.append(input, el("span", "ultls-toggle-track"));
    return wrap;
  }

  #numberControl(entry, value) {
    const wrap = el("div", "ultls-number");
    const { min, max, step } = entry.range;

    const slider = el("input", null, { type: "range", min, max, step, value });
    const readout = el("input", null, { type: "number", min, max, step, value });

    // Preview live while dragging; save when the handle is released.
    slider.addEventListener("input", () => {
      readout.value = slider.value;
      this.#preview(entry, Number(slider.value));
    });
    slider.addEventListener("change", () => this.#commit(entry, Number(slider.value)));

    readout.addEventListener("change", () => {
      const clamped = clamp(Number(readout.value) || 0, min, max);
      readout.value = clamped;
      slider.value = clamped;
      this.#commit(entry, clamped);
    });

    wrap.append(slider, readout);
    return wrap;
  }

  #selectControl(entry, value) {
    const select = el("select");
    for (const [optValue, i18nKey] of Object.entries(entry.choices)) {
      const opt = el("option", null, { value: optValue }, loc(i18nKey));
      if (optValue === value) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => this.#commit(entry, select.value));
    return select;
  }

  #textControl(entry, value) {
    const input = el("input", null, { type: "text", value: value ?? "" });
    input.addEventListener("change", () => this.#commit(entry, input.value));
    return input;
  }

  /**
   * A <select> of fonts Foundry has actually loaded — its own, those other
   * modules registered, and fonts added in Foundry's Font Configuration —
   * instead of a free-text field. One typo in a typed name silently fell back
   * to the browser default with no hint why; a list removes that failure mode.
   *
   * The current value is always kept selectable, even if it is not in the
   * detected list (say, its module is inactive right now), so opening this
   * window can never silently discard what was already set.
   */
  #fontControl(entry, value) {
    const select = el("select");
    const defaultOpt = el("option", null, { value: "" }, loc("ULTLS.Hub.FontDefaultOption"));
    select.appendChild(defaultOpt);

    const families = getAvailableFontFamilies();
    const current = String(value ?? "").trim();
    if (current && !families.includes(current)) families.unshift(current);

    for (const family of families) {
      const opt = el("option", null, { value: family }, family);
      opt.style.fontFamily = `"${family}"`;
      if (family === current) opt.selected = true;
      select.appendChild(opt);
    }
    if (!current) defaultOpt.selected = true;

    select.addEventListener("change", () => this.#commit(entry, select.value));
    return select;
  }

  #colorControl(entry, value) {
    const wrap = el("div", "ultls-color");
    const swatch = el("input", null, { type: "color", value: value || "#000000" });
    const text = el("input", null, { type: "text", value: value ?? "" });

    swatch.addEventListener("input", () => {
      text.value = swatch.value;
      this.#preview(entry, swatch.value);
    });
    swatch.addEventListener("change", () => this.#commit(entry, swatch.value));

    text.addEventListener("change", () => {
      const v = text.value.trim();
      if (/^#[0-9a-f]{6}$/i.test(v)) {
        swatch.value = v;
        this.#commit(entry, v.toLowerCase());
      } else {
        text.value = this.cfg[entry.key] ?? "";
      }
    });

    wrap.append(swatch, text);
    return wrap;
  }

  #pathControl(entry, value) {
    const wrap = el("div", "ultls-path");
    const text = el("input", null, { type: "text", value: value ?? "", readonly: true });

    const pick = el("button", "ultls-path-pick", { type: "button", title: loc("ULTLS.Hub.ChooseFile") });
    pick.appendChild(el("i", "fa-solid fa-folder-open", { "aria-hidden": "true" }));
    pick.addEventListener("click", () => {
      const FilePickerImpl = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      if (!FilePickerImpl) {
        ui.notifications?.warn(loc("ULTLS.Hub.NoFilePicker"));
        return;
      }
      const picker = new FilePickerImpl({
        type: entry.category ?? "image",
        current: text.value,
        callback: (path) => {
          text.value = path;
          this.#commit(entry, path);
        }
      });
      picker.render({ force: true });
    });

    const clear = el("button", "ultls-path-clear", { type: "button", title: loc("ULTLS.Hub.ClearPath") });
    clear.appendChild(el("i", "fa-solid fa-xmark", { "aria-hidden": "true" }));
    clear.addEventListener("click", () => {
      text.value = "";
      this.#commit(entry, "");
    });

    wrap.append(text, pick, clear);
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /*  Scenes                                                             */
  /* ------------------------------------------------------------------ */

  #buildScenesPanel() {
    const panel = this.#buildSchemaPanel("scenes");

    panel.appendChild(el("h3", "ultls-hub-subtitle", {}, loc("ULTLS.Hub.Scenes.ListTitle")));
    panel.appendChild(el("p", "notes", {}, loc("ULTLS.Menu.Scenes.Intro")));

    const actions = el("div", "ultls-scene-actions");
    const list = el("div", "ultls-scene-list");

    const makeAction = (labelKey, mode) => {
      const b = el("button", "ultls-scene-action", { type: "button" }, loc(labelKey));
      b.addEventListener("click", () => {
        for (const box of list.querySelectorAll('input[type="checkbox"]')) box.checked = mode === "all";
        this.#commitSceneIds(list);
      });
      return b;
    };
    actions.append(makeAction("ULTLS.Menu.Scenes.SelectAll", "all"), makeAction("ULTLS.Menu.Scenes.SelectNone", "none"));
    panel.appendChild(actions);

    const selected = new Set(getSceneIds(this.cfg));
    const current = resolveCurrentSceneId();
    let scenes = [];
    try {
      scenes = game.scenes?.contents ?? Array.from(game.scenes ?? []);
    } catch (err) {
      scenes = [];
    }

    if (scenes.length === 0) list.appendChild(el("p", "notes", {}, loc("ULTLS.Menu.Scenes.NoScenes")));

    for (const scene of scenes) {
      const row = el("div", "ultls-scene-row");
      const box = el("input", null, { type: "checkbox", id: `ultls-scene-${scene.id}` });
      box.checked = selected.has(scene.id);
      box.addEventListener("change", () => this.#commitSceneIds(list));

      row.append(box, el("label", null, { for: box.id }, scene.name ?? scene.id));
      if (scene.id === current) row.appendChild(el("span", "ultls-scene-badge", {}, loc("ULTLS.Menu.Scenes.Current")));
      list.appendChild(row);
    }

    panel.appendChild(list);
    panel.appendChild(el("p", "notes", {}, loc("ULTLS.Menu.Scenes.Hint")));
    return panel;
  }

  #commitSceneIds(list) {
    const ids = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map((b) =>
      b.id.replace("ultls-scene-", "")
    );
    this.cfg.sceneIds = ids.join(",");
    setSetting("sceneIds", this.cfg.sceneIds);
  }

  /* ------------------------------------------------------------------ */
  /*  Sound                                                              */
  /* ------------------------------------------------------------------ */

  #buildSoundPanel() {
    const panel = this.#buildSchemaPanel("sound");

    if (!this.cfg.soundPath) {
      panel.appendChild(el("p", "notes", {}, loc(this.isPlayer ? "ULTLS.Hub.Sound.EmptyPlayer" : "ULTLS.Hub.Sound.Empty")));
      return panel;
    }

    const row = el("div", "ultls-row");
    const test = button("", { className: "ultls-btn ultls-sound-test" });
    test.addEventListener("click", () => this.#toggleSoundTest());
    row.appendChild(test);
    panel.appendChild(row);
    panel.appendChild(el("p", "notes", {}, loc("ULTLS.Hub.Sound.Note")));

    this.#paintSoundButton(test);
    return panel;
  }

  #paintSoundButton(target = null) {
    const btn = target ?? this.element?.querySelector(".ultls-sound-test");
    if (!btn) return;
    const playing = Boolean(this.#soundTest);
    btn.replaceChildren(
      el("i", playing ? "fa-solid fa-stop" : "fa-solid fa-play", { "aria-hidden": "true" }),
      el("span", null, {}, loc(playing ? "ULTLS.Hub.Sound.Stop" : "ULTLS.Hub.Sound.Test"))
    );
  }

  #toggleSoundTest() {
    if (this.#soundTest) {
      this.#stopSoundTest();
      return;
    }

    const path = String(this.cfg.soundPath ?? "").trim();
    if (!path) {
      ui.notifications?.warn(loc("ULTLS.Hub.Sound.Empty"));
      return;
    }

    const sound = new LoadingSound({
      url: resolvePath(path),
      volume: this.cfg.soundVolume,
      loop: this.cfg.soundLoop,
      fadeInMs: this.cfg.soundFadeInMs,
      fadeOutMs: this.cfg.soundFadeOutMs,
      log: (message) => console.warn(`${MODULE_ID} |`, message)
    });
    // When playback ends on its own (a non-looping file), reset the button.
    sound.onEnd = () => {
      if (this.#soundTest === sound) {
        this.#soundTest = null;
        this.#paintSoundButton();
      }
    };
    this.#soundTest = sound;
    sound.start();
    this.#paintSoundButton();
  }

  #stopSoundTest() {
    const sound = this.#soundTest;
    this.#soundTest = null;
    sound?.fadeOutAndStop();
    this.#paintSoundButton();
  }

  /* ------------------------------------------------------------------ */
  /*  Tips                                                               */
  /* ------------------------------------------------------------------ */

  #buildTipsPanel() {
    const panel = this.#panel("tips");
    panel.appendChild(this.#sectionTitle(loc("ULTLS.Hub.Tab.tips")));

    // Schema-driven settings that live on this tab (the tip order) render
    // like they do on every other tab.
    for (const entry of schemaForTab("tips")) panel.appendChild(this.#renderField(entry));

    panel.appendChild(el("p", "notes", {}, loc("ULTLS.Menu.Tips.Intro")));

    // --- toolbar: one delay for all, add, seed --------------------------------
    const defaultSec = Math.round((Number(this.cfg.tipIntervalMs) || 6000) / 100) / 10;

    const delayBar = el("div", "ultls-tips-bar");
    delayBar.appendChild(el("span", "ultls-tips-bar-label", {}, loc("ULTLS.Hub.Tips.DelayAllLabel")));
    const delayInput = el("input", "ultls-tip-sec", {
      type: "number",
      min: TIP_LIMITS.minSec,
      max: TIP_LIMITS.maxSec,
      step: 0.5,
      value: defaultSec,
      "aria-label": loc("ULTLS.Hub.Tips.DelayAllLabel")
    });
    delayBar.appendChild(delayInput);
    delayBar.appendChild(el("span", "ultls-tips-bar-unit", {}, loc("ULTLS.Hub.Tips.Seconds")));

    const applyAll = button(loc("ULTLS.Hub.Tips.DelayAllApply"), { icon: "fa-solid fa-clock" });
    applyAll.addEventListener("click", () => {
      const sec = clamp(Number(delayInput.value) || defaultSec, TIP_LIMITS.minSec, TIP_LIMITS.maxSec);
      delayInput.value = sec;
      for (const tip of this.#tips) tip.sec = sec;
      this.#renderTipRows();
      this.#persistTips(true);
      ui.notifications?.info(fmt("ULTLS.Notify.TipsDelayApplied", { count: this.#tips.length, seconds: sec }));
    });

    const resetAll = button(loc("ULTLS.Hub.Tips.DelayReset"), { icon: "fa-solid fa-rotate-left" });
    resetAll.addEventListener("click", () => {
      for (const tip of this.#tips) tip.sec = null;
      this.#renderTipRows();
      this.#persistTips(true);
    });
    delayBar.append(applyAll, resetAll);
    panel.appendChild(delayBar);

    const addBar = el("div", "ultls-tips-bar");
    const add = button(loc("ULTLS.Hub.Tips.Add"), { icon: "fa-solid fa-plus" });
    add.addEventListener("click", () => {
      this.#tips.push({ text: "", sec: null });
      this.#renderTipRows();
      this.#tipsListEl?.querySelector(".ultls-tip-row:last-child .ultls-tip-text")?.focus();
    });
    addBar.appendChild(add);

    const seed = (kind, labelKey) => {
      const b = button(loc(labelKey), { icon: "fa-solid fa-wand-magic-sparkles" });
      b.addEventListener("click", () => {
        const existing = new Set(this.#tips.map((t) => t.text));
        const fresh = getSeedTips(kind, SEED_BATCH, existing);
        if (fresh.length === 0) {
          ui.notifications?.info(loc("ULTLS.Notify.TipsSeedNone"));
          return;
        }
        for (const text of fresh) this.#tips.push({ text, sec: null });
        this.#renderTipRows();
        this.#persistTips(true);
        ui.notifications?.info(fmt("ULTLS.Notify.TipsSeeded", { count: fresh.length }));
      });
      return b;
    };
    addBar.append(
      seed("atmospheric", "ULTLS.Menu.Tips.SeedAtmospheric"),
      seed("foundry", "ULTLS.Menu.Tips.SeedFoundry")
    );
    panel.appendChild(addBar);
    panel.appendChild(el("p", "notes", {}, fmt("ULTLS.Menu.Tips.SeedHint", { count: SEED_BATCH })));

    // --- the list itself ------------------------------------------------------
    this.#tipsCountEl = el("p", "ultls-hub-meta");
    panel.appendChild(this.#tipsCountEl);

    this.#tipsListEl = el("div", "ultls-tip-list");
    panel.appendChild(this.#tipsListEl);
    this.#renderTipRows();

    panel.appendChild(el("p", "notes", {}, loc("ULTLS.Menu.Tips.Hint")));
    return panel;
  }

  /** Rebuild the rows from the in-memory list. Cheap; the list is small. */
  #renderTipRows() {
    const list = this.#tipsListEl;
    if (!list) return;

    const defaultSec = Math.round((Number(this.cfg.tipIntervalMs) || 6000) / 100) / 10;
    list.replaceChildren();

    if (this.#tips.length === 0) {
      list.appendChild(el("p", "ultls-tip-empty", {}, loc("ULTLS.Hub.Tips.Empty")));
    }

    this.#tips.forEach((tip, index) => {
      const row = el("div", "ultls-tip-row");
      row.appendChild(el("span", "ultls-tip-num", {}, String(index + 1)));

      const text = el("textarea", "ultls-tip-text", { rows: 2, placeholder: loc("ULTLS.Hub.Tips.RowPlaceholder") });
      text.value = tip.text;
      text.addEventListener("input", () => {
        tip.text = text.value;
        this.#persistTips();
      });
      // Pasting several lines splits them into separate tips.
      text.addEventListener("paste", (event) => {
        const pasted = event.clipboardData?.getData("text") ?? "";
        if (!/\r?\n/.test(pasted)) return;
        event.preventDefault();
        const lines = pasted.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (lines.length === 0) return;
        tip.text = lines[0];
        this.#tips.splice(index + 1, 0, ...lines.slice(1).map((line) => ({ text: line, sec: null })));
        this.#renderTipRows();
        this.#persistTips(true);
      });
      row.appendChild(text);

      const secWrap = el("div", "ultls-tip-sec-wrap");
      const sec = el("input", "ultls-tip-sec", {
        type: "number",
        min: TIP_LIMITS.minSec,
        max: TIP_LIMITS.maxSec,
        step: 0.5,
        placeholder: String(defaultSec),
        title: loc("ULTLS.Hub.Tips.SecondsHint")
      });
      sec.value = tip.sec ?? "";
      sec.addEventListener("change", () => {
        tip.sec = sec.value === "" ? null : clamp(Number(sec.value) || defaultSec, TIP_LIMITS.minSec, TIP_LIMITS.maxSec);
        sec.value = tip.sec ?? "";
        this.#persistTips(true);
      });
      secWrap.append(sec, el("span", "ultls-tips-bar-unit", {}, loc("ULTLS.Hub.Tips.Seconds")));
      row.appendChild(secWrap);

      const tools = el("div", "ultls-tip-tools");
      const move = (delta, iconClass, titleKey) => {
        const b = el("button", "ultls-icon-btn-sm", { type: "button", title: loc(titleKey) });
        b.appendChild(el("i", iconClass, { "aria-hidden": "true" }));
        const target = index + delta;
        if (target < 0 || target >= this.#tips.length) b.disabled = true;
        b.addEventListener("click", () => {
          [this.#tips[index], this.#tips[target]] = [this.#tips[target], this.#tips[index]];
          this.#renderTipRows();
          this.#persistTips(true);
        });
        return b;
      };
      tools.append(move(-1, "fa-solid fa-arrow-up", "ULTLS.Hub.Tips.MoveUp"), move(1, "fa-solid fa-arrow-down", "ULTLS.Hub.Tips.MoveDown"));

      const remove = el("button", "ultls-icon-btn-sm is-danger", { type: "button", title: loc("ULTLS.Hub.Tips.Delete") });
      remove.appendChild(el("i", "fa-solid fa-trash", { "aria-hidden": "true" }));
      remove.addEventListener("click", () => {
        this.#tips.splice(index, 1);
        this.#renderTipRows();
        this.#persistTips(true);
      });
      tools.appendChild(remove);
      row.appendChild(tools);

      list.appendChild(row);
    });

    this.#paintTipCount();
  }

  #paintTipCount() {
    if (!this.#tipsCountEl) return;
    const count = this.#tips.filter((t) => t.text.trim()).length;
    this.#tipsCountEl.textContent = fmt("ULTLS.Hub.Tips.Count", { count });
  }

  /** Save the tip list, debounced while typing and immediate for structural edits. */
  #persistTips(immediate = false) {
    window.clearTimeout(this.#tipsSaveTimer);
    const save = () => {
      const serialized = serializeTips(this.#tips);
      this.cfg.loreTips = serialized;
      setSetting("loreTips", serialized);
      this.#paintTipCount();
      this.#refreshPreview();
    };
    if (immediate) save();
    else this.#tipsSaveTimer = window.setTimeout(save, 400);
  }

  /* ------------------------------------------------------------------ */
  /*  Presets: export, import, reset                                     */
  /* ------------------------------------------------------------------ */

  #buildPresetsPanel() {
    const panel = this.#panel("presets");
    panel.appendChild(this.#sectionTitle(loc("ULTLS.Hub.Tab.presets")));
    panel.appendChild(el("p", "notes", {}, loc("ULTLS.Hub.Presets.Intro")));

    // --- export -----------------------------------------------------------
    panel.appendChild(el("h3", "ultls-hub-subtitle", {}, loc("ULTLS.Hub.Presets.ExportTitle")));
    panel.appendChild(el("p", "notes", {}, loc("ULTLS.Hub.Presets.ExportText")));

    const exportRow = el("div", "ultls-row");
    const toFile = button(loc("ULTLS.Hub.Presets.ExportFile"), { icon: "fa-solid fa-file-arrow-down" });
    toFile.addEventListener("click", () => this.#exportPreset("file"));
    const toClipboard = button(loc("ULTLS.Hub.Presets.ExportCopy"), { icon: "fa-solid fa-copy" });
    toClipboard.addEventListener("click", () => this.#exportPreset("clipboard"));
    exportRow.append(toFile, toClipboard);
    panel.appendChild(exportRow);

    // --- import -----------------------------------------------------------
    panel.appendChild(el("h3", "ultls-hub-subtitle", {}, loc("ULTLS.Hub.Presets.ImportTitle")));
    panel.appendChild(el("p", "notes", {}, loc("ULTLS.Hub.Presets.ImportText")));

    const summary = el("div", "ultls-import-summary");
    summary.hidden = true;

    const importRow = el("div", "ultls-row");
    const fileInput = el("input", null, { type: "file", accept: ".json,application/json", hidden: "true" });
    const chooseFile = button(loc("ULTLS.Hub.Presets.ImportFile"), { icon: "fa-solid fa-file-import" });
    chooseFile.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      try {
        this.#previewImport(await file.text(), summary);
      } catch (err) {
        this.#showImportError(summary, "json");
      }
    });
    importRow.append(chooseFile, fileInput);
    panel.appendChild(importRow);

    const paste = el("textarea", "ultls-preset-paste", { rows: 4, placeholder: loc("ULTLS.Hub.Presets.PastePlaceholder") });
    panel.appendChild(paste);
    const pasteRow = el("div", "ultls-row");
    const fromText = button(loc("ULTLS.Hub.Presets.ImportPaste"), { icon: "fa-solid fa-paste" });
    fromText.addEventListener("click", () => this.#previewImport(paste.value, summary));
    pasteRow.appendChild(fromText);
    panel.appendChild(pasteRow);
    panel.appendChild(summary);

    // --- reset --------------------------------------------------------------
    panel.appendChild(el("h3", "ultls-hub-subtitle", {}, loc("ULTLS.Hub.Presets.ResetTitle")));
    panel.appendChild(el("p", "notes", {}, loc("ULTLS.Hub.Presets.ResetText")));
    panel.appendChild(this.#buildResetRow());

    return panel;
  }

  /**
   * The "reset everything" control, shared by the Presets tab and the Home tab.
   * A tick box decides whether the tips go too — off by default, because tips
   * are text somebody wrote and the one thing a reset must not throw away by
   * accident — and the button itself needs two clicks a few seconds apart.
   */
  #buildResetRow() {
    const row = el("div", "ultls-row ultls-reset-row");

    const label = el("label", "ultls-check");
    const box = el("input", null, { type: "checkbox" });
    label.append(box, el("span", null, {}, loc("ULTLS.Hub.Presets.ResetTips")));

    const reset = button(loc("ULTLS.Hub.Presets.ResetButton"), { icon: "fa-solid fa-rotate-left", className: "ultls-btn is-danger" });
    const setLabel = (key) => {
      reset.querySelector("span").textContent = loc(key);
    };

    reset.addEventListener("click", () => {
      window.clearTimeout(this.#resetTimer);

      if (reset.dataset.armed === "true") {
        reset.dataset.armed = "false";
        setLabel("ULTLS.Hub.Presets.ResetButton");
        this.#resetToDefaults({ clearTips: box.checked });
        return;
      }

      reset.dataset.armed = "true";
      setLabel("ULTLS.Hub.Presets.ResetConfirm");
      this.#resetTimer = window.setTimeout(() => {
        reset.dataset.armed = "false";
        setLabel("ULTLS.Hub.Presets.ResetButton");
      }, 4000);
    });

    row.append(reset, label);
    return row;
  }

  async #exportPreset(target) {
    const preset = buildPreset(this.cfg, installedVersion());
    const text = JSON.stringify(preset, null, 2);

    if (target === "clipboard") {
      try {
        await navigator.clipboard.writeText(text);
        ui.notifications?.info(loc("ULTLS.Notify.PresetCopied"));
      } catch (err) {
        // Clipboard access can be refused; a file is the reliable fallback.
        downloadText(this.#presetFilename(), text);
        ui.notifications?.warn(loc("ULTLS.Notify.PresetCopyFailed"));
      }
      return;
    }

    downloadText(this.#presetFilename(), text);
    ui.notifications?.info(loc("ULTLS.Notify.PresetSaved"));
  }

  #presetFilename() {
    const stamp = new Date().toISOString().slice(0, 10);
    return `ult-ls-preset-${stamp}.json`;
  }

  /** Parse and show what an import would do; nothing is applied until confirmed. */
  #previewImport(text, summary) {
    const result = parsePreset(text);
    if (!result.ok) {
      this.#showImportError(summary, result.error);
      return;
    }

    summary.hidden = false;
    summary.classList.remove("is-error");
    summary.replaceChildren();
    summary.appendChild(el("p", null, {}, fmt("ULTLS.Hub.Presets.Summary", { applied: result.applied, skipped: result.skipped })));
    if (result.meta.moduleVersion) {
      summary.appendChild(el("p", "notes", {}, fmt("ULTLS.Hub.Presets.SummaryFrom", { version: result.meta.moduleVersion })));
    }

    const row = el("div", "ultls-row");
    const apply = button(loc("ULTLS.Hub.Presets.Apply"), { icon: "fa-solid fa-check", className: "ultls-btn is-primary" });
    apply.addEventListener("click", async () => {
      summary.hidden = true;
      await this.#applyPreset(result);
    });
    const cancel = button(loc("ULTLS.Hub.Presets.Cancel"), { icon: "fa-solid fa-xmark" });
    cancel.addEventListener("click", () => {
      summary.hidden = true;
    });
    row.append(apply, cancel);
    summary.appendChild(row);
  }

  #showImportError(summary, kind) {
    summary.hidden = false;
    summary.classList.add("is-error");
    summary.replaceChildren(el("p", null, {}, loc(kind === "format" ? "ULTLS.Hub.Presets.ErrorFormat" : "ULTLS.Hub.Presets.ErrorJson")));
  }

  async #applyPreset(result) {
    for (const [key, value] of Object.entries(result.values)) {
      this.cfg[key] = value;
      await setSetting(key, value);
    }
    if (result.tips) {
      const serialized = serializeTips(result.tips);
      this.cfg.loreTips = serialized;
      this.#tips = parseTips(serialized);
      await setSetting("loreTips", serialized);
    }

    this.#rebuildAll();
    this.#refreshPreview();
    this.#flagReload();
    ui.notifications?.info(fmt("ULTLS.Notify.PresetImported", { count: result.applied }));
  }

  /** Every setting back to its starting value. The tips stay unless `clearTips` is set. */
  async #resetToDefaults({ clearTips = false } = {}) {
    for (const [key, value] of Object.entries(getAllDefaults())) {
      this.cfg[key] = value;
      await setSetting(key, value);
    }

    if (clearTips) {
      this.cfg.loreTips = "";
      this.#tips = [];
      await setSetting("loreTips", "");
    }

    this.#rebuildAll();
    this.#refreshPreview();
    this.#flagReload();
    ui.notifications?.info(loc("ULTLS.Notify.PresetReset"));
  }

  /* ------------------------------------------------------------------ */
  /*  Live preview                                                       */
  /* ------------------------------------------------------------------ */

  #buildPreview() {
    const wrap = el("div", "ultls-hub-preview");
    wrap.appendChild(el("div", "ultls-hub-preview-label", {}, loc("ULTLS.Hub.PreviewLabel")));
    const frame = el("div", "ultls-hub-preview-frame");
    wrap.appendChild(frame);
    this._previewFrame = frame;
    this.#refreshPreview();
    return wrap;
  }

  #refreshPreview() {
    const frame = this._previewFrame;
    if (!frame) return;

    const tips = parseTips(this.cfg.loreTips).filter((t) => t.text);
    const { root, refs } = buildOverlayDOM(this.cfg, { preview: true, hasTips: tips.length > 0 });

    // Paint a representative static frame rather than 0% / empty text, so the
    // preview shows what a mid-load screen looks like.
    const sampleTip = tips[0]?.text ?? loc("ULTLS.Tip.Sample");
    if (refs.tipEl) {
      refs.tipEl.textContent = sampleTip;
      refs.tipEl.classList.add("is-visible");
    }
    if (refs.percentEl) refs.percentEl.textContent = "62%";
    if (refs.stageEl) refs.stageEl.textContent = loc(SAMPLE_STAGE_KEY);
    if (refs.fillEl) refs.fillEl.style.width = "62%";
    if (refs.ringEl) refs.ringEl.style.setProperty("--ultls-progress", "62");
    if (refs.units?.length) {
      const filled = Math.round(refs.units.length * 0.62);
      refs.units.forEach((u, i) => u.classList.toggle("is-on", i < filled));
    }

    frame.replaceChildren(root);
  }

  /* ------------------------------------------------------------------ */
  /*  Footer                                                             */
  /* ------------------------------------------------------------------ */

  #buildFooter() {
    const footer = el("div", "ultls-hub-footer");

    const status = el("div", "ultls-hub-status");
    this._statusEl = status;
    this.#paintStatus();
    footer.appendChild(status);

    const brand = el("div", "ultls-hub-brand");
    brand.appendChild(el("span", null, {}, "ULT's Loading Screen"));
    brand.appendChild(el("span", "ultls-hub-signature", {}, "by 4isfate"));
    footer.appendChild(brand);

    const actions = el("div", "ultls-hub-actions");

    const githubBtn = el("a", "ultls-hub-icon-btn", {
      href: GITHUB_URL,
      target: "_blank",
      rel: "noopener noreferrer",
      title: loc("ULTLS.Hub.GitHub")
    });
    githubBtn.appendChild(el("i", "fa-brands fa-github", { "aria-hidden": "true" }));
    actions.appendChild(githubBtn);

    // The wrapper carries the tooltip: a disabled button does not reliably
    // show its own. This button is a placeholder for a future companion module.
    const hubWrap = el("span", "ultls-hub-icon-wrap", { title: loc("ULTLS.Hub.ModuleHub") });
    const hubBtn = el("button", "ultls-hub-icon-btn is-disabled", { type: "button", disabled: "true" });
    hubBtn.appendChild(el("i", "fa-solid fa-diagram-project", { "aria-hidden": "true" }));
    hubWrap.appendChild(hubBtn);
    actions.appendChild(hubWrap);

    footer.appendChild(actions);
    return footer;
  }

  #flagReload() {
    this.reloadPending = true;
    this.#paintStatus();
  }

  #paintStatus() {
    const node = this._statusEl;
    if (!node) return;
    node.replaceChildren();

    if (this.reloadPending) {
      node.className = "ultls-hub-status is-pending";
      node.appendChild(el("i", "fa-solid fa-rotate-right", { "aria-hidden": "true" }));
      node.appendChild(el("span", null, {}, loc("ULTLS.Hub.ReloadNeeded")));
    } else {
      node.className = "ultls-hub-status is-saved";
      node.appendChild(el("i", "fa-solid fa-check", { "aria-hidden": "true" }));
      node.appendChild(el("span", null, {}, loc(this.isPlayer ? "ULTLS.Personal.Saved" : "ULTLS.Hub.Saved")));
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Entry point                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Open this window, or bring the existing one to the front. Asks Foundry's
   * own registry first, so a window opened from the settings menu button is
   * found too and never duplicated.
   */
  static open() {
    const existing = foundry.applications.instances?.get?.(this.DEFAULT_OPTIONS.id);
    if (existing?.rendered) {
      existing.bringToFront?.();
      return existing;
    }
    const app = new this();
    app.render({ force: true });
    return app;
  }
}

/**
 * The players' window. It is the same class in `player` mode: only the mode
 * and the window id differ, so it can be open next to nothing else with the
 * same id, and Foundry can construct it with no arguments from a menu button.
 */
export class LoadingScreenPersonalHub extends LoadingScreenHub {
  static DEFAULT_OPTIONS = {
    id: "ultls-hub-personal",
    window: {
      title: "ULTLS.Personal.Title",
      icon: "fa-solid fa-palette"
    },
    position: { width: 880, height: 700 }
  };

  static MODE = "player";
}
