# Source Note: agent bots in play sessions (2026-09-27)

Source: chat play session with the user (rooms JSSF, GDHP, 6PVQ), PRs #219,
#221, #223 and issues #222, #224. Ingested: 2026-09-27 (#225).

## Summary

- Two room bots exist: the browser bot (`core/tools/room-bot.mjs`, Playwright
  running the real game) and the headless bot
  (`core/tools/headless-room-bot.mjs`, Node speaking the room protocol and
  driving with the shared rule/physics modules since #219).
- The user asked for a technical comparison; the agent answered with a table
  (hosting, physics, protocol, timing, weight, fidelity, weak points) and the
  conclusion "browser bot to find game bugs, headless for long or crowded
  races". The user asked to file it in the wiki.
- Observed in play: the browser bot caught the #222 black screen (missing
  `race-rules.js` import) through `pageerror`; after a race it re-reserved a
  different driver on the rematch and blocked the room (#224); the headless
  bot logged repeated `ready` lines and retried every 2 s while the tunnel
  answered 502.
- User rules stated in the session: run two bots with different strategies,
  named `claude-browser` and `claude-headless`; announce strategy on the
  room radio ("il microfono"); restart from a fresh room instead of the
  rematch while #224 is open.
