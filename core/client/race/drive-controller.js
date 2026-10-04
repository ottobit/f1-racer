// Provider-neutral high-level driving controller (#377).
//
// The remote/slow decision layer supplies a bounded DrivingIntent
// (pace/line/horizon). This controller runs locally in the race page and
// asks the existing geometry autopilot for low-level steer/throttle/brake on
// every browser frame. It owns no transport, model or multiplayer logic.
const PACE_MIN = 0.5;
const PACE_MAX = 1;
const LINE_MIN = -1;
const LINE_MAX = 1;
const HORIZON_MIN_MS = 100;
const HORIZON_MAX_MS = 5000;
const DEFAULT_HORIZON_MS = 750;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export class DriveController {
  constructor({ provider }) {
    if (!provider || typeof provider.decide !== "function") {
      throw new Error("f1-drive-controller: a fast driving provider is required");
    }
    this.provider = provider;
    this.intent = null;
    this.expiresAt = 0;
  }

  setIntent(intent = {}, now = performance.now()) {
    if (!intent || typeof intent !== "object") {
      throw new Error("f1-drive-controller: intent must be an object");
    }
    const pace = Number(intent.pace);
    const line = Number(intent.line);
    const horizonMs = Number(intent.horizonMs);
    this.intent = {
      pace: Number.isFinite(pace) ? clamp(pace, PACE_MIN, PACE_MAX) : 0.86,
      line: Number.isFinite(line) ? clamp(line, LINE_MIN, LINE_MAX) : 0,
      horizonMs: Number.isFinite(horizonMs)
        ? clamp(horizonMs, HORIZON_MIN_MS, HORIZON_MAX_MS)
        : DEFAULT_HORIZON_MS,
      confidence: Number.isFinite(Number(intent.confidence))
        ? clamp(Number(intent.confidence), 0, 1)
        : null,
    };
    this.expiresAt = now + this.intent.horizonMs;
    return this.snapshot(now);
  }

  update(car, dt, now = performance.now()) {
    if (!this.intent || now >= this.expiresAt) return null;
    const out = this.provider.decide(car, dt, {
      pace: this.intent.pace,
      line: this.intent.line,
      ers: "auto",
      tyre: null,
      station: null,
      autoPit: false,
    });
    return {
      steer: out.steer,
      throttle: out.throttle,
      brake: out.brake,
    };
  }

  release() {
    this.intent = null;
    this.expiresAt = 0;
  }

  snapshot(now = performance.now()) {
    if (!this.intent) return null;
    return {
      ...this.intent,
      remainingMs: Math.max(0, Math.round(this.expiresAt - now)),
    };
  }
}
