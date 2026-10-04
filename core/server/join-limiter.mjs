// Join brute-force guard (#371): an address that keeps sending wrong room
// codes or reconnect tokens is refused for a while, so guessing a 6-char
// code (~887M) would take years. In memory, like the rooms themselves.
// X-Forwarded-For can be forged to look like many addresses, so a global
// ceiling on wrong guesses holds the line even then (at the cost of
// slowing honest joins during such an attack).
export const MAX_FAILURES = 10;
export const MAX_GLOBAL_FAILURES = 200;
export const WINDOW_MS = 60_000;
const GLOBAL = Symbol("all addresses");

export class JoinLimiter {
  #failures = new Map(); // address -> { count, since }

  constructor({ maxFailures = MAX_FAILURES, maxGlobalFailures = MAX_GLOBAL_FAILURES, windowMs = WINDOW_MS, now = Date.now } = {}) {
    this.maxFailures = maxFailures;
    this.maxGlobalFailures = maxGlobalFailures;
    this.windowMs = windowMs;
    this.now = now;
  }

  #entry(address) {
    const entry = this.#failures.get(address);
    if (entry && this.now() - entry.since >= this.windowMs) {
      this.#failures.delete(address);
      return null;
    }
    return entry ?? null;
  }

  blocked(address) {
    return (this.#entry(address)?.count ?? 0) >= this.maxFailures
      || (this.#entry(GLOBAL)?.count ?? 0) >= this.maxGlobalFailures;
  }

  fail(address) {
    for (const key of [address, GLOBAL]) {
      const entry = this.#entry(key);
      if (entry) entry.count += 1;
      else this.#failures.set(key, { count: 1, since: this.now() });
    }
  }

  // Drops expired entries; call periodically so the map cannot grow forever.
  prune() {
    for (const address of [...this.#failures.keys()]) this.#entry(address);
  }
}

// Render and most hosts sit behind a proxy: the client is the first
// X-Forwarded-For hop.
export function clientAddress(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  const first = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "";
  return first || req?.socket?.remoteAddress || "unknown";
}
