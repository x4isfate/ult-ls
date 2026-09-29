/**
 * ULT's Loading Screen — the loading sound.
 *
 * A thin wrapper around a plain HTMLAudioElement rather than Foundry's own
 * audio classes: it has no dependency on which audio API a given Foundry
 * version exposes, and the whole surface is small enough to reason about
 * (start, fade out, stop).
 *
 * Browsers refuse to start sound on a page the user has not interacted with
 * yet. Foundry's desktop app disables that rule, a normal browser does not. So
 * when the first `play()` is rejected the sound is not abandoned: it waits for
 * the first click or key press anywhere on the page and starts then, fading in
 * as usual. If the world finishes loading before that happens the sound simply
 * never plays, which is the right outcome — a loading sound that begins after
 * the loading is over would be worse than none.
 *
 * The sound outlives the overlay on purpose. `fadeOutAndStop()` keeps running
 * after the overlay element is gone, so a fade-out longer than the overlay's
 * own fade finishes smoothly instead of being cut off.
 */

import { MODULE_ID } from "./settings.js";

const FADE_STEP_MS = 40;

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

/**
 * Foundry's "Interface" volume slider, as an actual gain, so a player who has
 * turned interface sounds down (or off) also silences this one. Falls back to
 * full volume if the setting cannot be read.
 */
export function interfaceGain() {
  try {
    const stored = game.settings.get("core", "globalInterfaceVolume");
    if (typeof stored !== "number") return 1;
    const toGain = foundry?.audio?.AudioHelper?.inputToVolume;
    return clamp01(typeof toGain === "function" ? toGain.call(foundry.audio.AudioHelper, stored) : stored);
  } catch (err) {
    return 1;
  }
}

export class LoadingSound {
  /**
   * @param {object} options
   * @param {string} options.url          Already-resolved, fetchable URL.
   * @param {number} options.volume       0–100, the module's own volume setting.
   * @param {boolean} options.loop
   * @param {number} options.fadeInMs
   * @param {number} options.fadeOutMs
   * @param {(message: string) => void} [options.log]
   */
  constructor({ url, volume = 80, loop = true, fadeInMs = 1500, fadeOutMs = 1500, log = () => {} }) {
    this.url = url;
    this.target = clamp01(volume / 100) * interfaceGain();
    this.loop = Boolean(loop);
    this.fadeInMs = Math.max(0, Number(fadeInMs) || 0);
    this.fadeOutMs = Math.max(0, Number(fadeOutMs) || 0);
    this.log = log;

    this.audio = null;
    this.fadeTimer = null;
    this.stopped = false;
    this.playing = false;
    this.gestureHandler = null;
    /** Called once when playback ends by itself or the sound is stopped. */
    this.onEnd = null;
  }

  /** Try to start playback. Never throws; failures are reported through `log`. */
  async start() {
    if (this.stopped || !this.url) return false;

    try {
      this.audio = new Audio(this.url);
      this.audio.loop = this.loop;
      this.audio.volume = 0;
      this.audio.preload = "auto";
      // Releasing the element (removeAttribute + load) can itself raise a
      // spurious "error"; once `this.audio` is cleared these must do nothing.
      this.audio.addEventListener("error", () => {
        if (!this.audio) return;
        this.log(`sound could not be loaded: ${this.url}`);
        this.#finish();
      });
      this.audio.addEventListener("ended", () => {
        if (this.audio) this.#finish();
      });
    } catch (err) {
      this.log(`sound could not be created: ${err?.message ?? err}`);
      return false;
    }

    return this.#play();
  }

  async #play() {
    if (this.stopped || !this.audio) return false;

    try {
      await this.audio.play();
      this.playing = true;
      this.#fadeTo(this.target, this.fadeInMs);
      return true;
    } catch (err) {
      if (err?.name === "NotAllowedError") {
        this.log("sound blocked by the browser until the first click or key press; waiting for it");
        this.#waitForGesture();
      } else if (err?.name !== "AbortError") {
        this.log(`sound could not be played: ${err?.message ?? err}`);
      }
      return false;
    }
  }

  /**
   * Window-level capture listeners run before the overlay's own document-level
   * input blockers, so the click that unlocks audio is not swallowed by them.
   */
  #waitForGesture() {
    if (this.gestureHandler) return;

    const events = ["pointerdown", "keydown", "touchstart"];
    const handler = () => {
      this.#clearGesture();
      this.#play();
    };
    this.gestureHandler = { events, handler };
    for (const type of events) window.addEventListener(type, handler, { capture: true, once: true });
  }

  #clearGesture() {
    if (!this.gestureHandler) return;
    const { events, handler } = this.gestureHandler;
    for (const type of events) window.removeEventListener(type, handler, { capture: true });
    this.gestureHandler = null;
  }

  /** Linear volume ramp from the current level to `to` over `ms`. */
  #fadeTo(to, ms, onDone = null) {
    window.clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    if (!this.audio) return;

    const from = this.audio.volume;
    if (ms <= 0 || from === to) {
      this.audio.volume = clamp01(to);
      onDone?.();
      return;
    }

    const startedAt = performance.now();
    this.fadeTimer = window.setInterval(() => {
      if (!this.audio) {
        window.clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        return;
      }
      const t = Math.min(1, (performance.now() - startedAt) / ms);
      this.audio.volume = clamp01(from + (to - from) * t);
      if (t >= 1) {
        window.clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        onDone?.();
      }
    }, FADE_STEP_MS);
  }

  /** Fade to silence over the configured time (or `ms`), then release the audio. */
  fadeOutAndStop(ms = this.fadeOutMs) {
    if (this.stopped) return;
    this.stopped = true;
    this.#clearGesture();

    if (!this.audio || !this.playing) {
      this.#finish();
      return;
    }

    this.#fadeTo(0, Math.max(0, Number(ms) || 0), () => this.#finish());
  }

  /** Stop at once, with no fade. */
  stop() {
    this.stopped = true;
    this.#clearGesture();
    this.#finish();
  }

  #finish() {
    window.clearInterval(this.fadeTimer);
    this.fadeTimer = null;
    this.#clearGesture();
    this.playing = false;

    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.removeAttribute("src");
        this.audio.load();
      } catch (err) {
        /* already released */
      }
      this.audio = null;
    }

    const callback = this.onEnd;
    this.onEnd = null;
    try {
      callback?.();
    } catch (err) {
      console.warn(`${MODULE_ID} | sound end callback failed`, err);
    }
  }
}
