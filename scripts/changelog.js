/**
 * ULT's Loading Screen — the "what's new" window.
 *
 * Shown to the GM when they enter a world after the module has been updated.
 * It has two ways out, deliberately different:
 *
 *   Close                          just closes it; it appears again next time.
 *   Don't show until next update   remembers the current version, so the window
 *                                  stays away until the module version changes.
 *
 * Built as plain DOM on ApplicationV2, the same way the Hub is, so it does not
 * depend on any template file.
 *
 * To add a release: put a new entry at the TOP of CHANGELOG below, add its
 * `ULTLS.Changelog.<id>.Title` and `ULTLS.Changelog.<id>.Item.NN` strings to
 * every file in lang/, and add the same notes to CHANGELOG.md.
 */

import { MODULE_ID, getSetting, setSetting } from "./settings.js";
import { el } from "./loading-screen.js";

/** Newest first. `id` is the version with dots as underscores; `items` counts the bullet strings. */
export const CHANGELOG = [{ version: "1.4.0", id: "1_4_0", items: 13 }];

function loc(key) {
  return game.i18n.localize(key);
}

export function installedVersion() {
  try {
    return String(game.modules?.get?.(MODULE_ID)?.version ?? "");
  } catch (err) {
    return "";
  }
}

export class ChangelogWindow extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "ultls-changelog",
    classes: ["ultls-hub-app", "ultls-changelog-app"],
    tag: "div",
    window: {
      title: "ULTLS.Changelog.WindowTitle",
      icon: "fa-solid fa-scroll",
      resizable: false
    },
    position: { width: 580, height: "auto" }
  };

  async _renderHTML() {
    const root = el("div", "ultls-changelog");

    for (const release of CHANGELOG) {
      const section = el("section", "ultls-changelog-release");

      const heading = el("h2", "ultls-changelog-title", {}, `${release.version} — ${loc(`ULTLS.Changelog.${release.id}.Title`)}`);
      section.appendChild(heading);

      const list = el("ul", "ultls-changelog-list");
      for (let i = 1; i <= release.items; i++) {
        const key = `ULTLS.Changelog.${release.id}.Item.${String(i).padStart(2, "0")}`;
        const text = loc(key);
        if (text === key) continue;
        list.appendChild(el("li", null, {}, text));
      }
      section.appendChild(list);
      root.appendChild(section);
    }

    const footer = el("div", "ultls-changelog-footer");

    const dismiss = el("button", "ultls-btn", { type: "button" }, loc("ULTLS.Changelog.Dismiss"));
    dismiss.addEventListener("click", async () => {
      await setSetting("changelogSeen", installedVersion());
      ui.notifications?.info(loc("ULTLS.Changelog.DismissedNote"));
      this.close();
    });

    const close = el("button", "ultls-btn is-primary", { type: "button" }, loc("ULTLS.Changelog.Close"));
    close.addEventListener("click", () => this.close());

    footer.append(dismiss, close);
    root.appendChild(footer);

    return root;
  }

  async _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  static open() {
    const existing = foundry.applications.instances?.get?.("ultls-changelog");
    if (existing?.rendered) {
      existing.bringToFront?.();
      return existing;
    }
    const app = new ChangelogWindow();
    app.render({ force: true });
    return app;
  }
}

/**
 * Show the window if this GM has not silenced it for the current version.
 * `force` opens it regardless (used by the Hub's "what's new" button).
 */
export function maybeShowChangelog({ force = false } = {}) {
  if (!force) {
    if (!game.user?.isGM) return null;
    const version = installedVersion();
    if (!version || getSetting("changelogSeen") === version) return null;
  }
  return ChangelogWindow.open();
}
