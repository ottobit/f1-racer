# F1 Racer Overview

F1 Racer is the active flagship game in `portfolio-arcade`. It is a static
browser game built with plain HTML/CSS/JavaScript and Three.js.

## Current Shape

- The race page has been split out of the original monolithic `main.js` into
  focused modules for input, HUD, camera, AI, player physics, race systems,
  race progress, car view and race commands.
- The procedural car is shared between race and garage through
  `car-model.js`.
- The garage persists setup choices through `garage-setup.js`.
- Driver names are stored in `shared/driver-roster.js` (F1) and
  `classic-series.js` (Classiche); player display selection is
  handled by `driver-selection.js`.
- The user prefers the top HUD panel as-is and wants manual gameplay validation
  instead of automated browser smoke tests by default.

## Current User Priorities

- Keep improving the visual spectacle of the race and garage.
- Make controls comfortable on touch devices with large thumbs.
- Make the garage show meaningful visual effects while choosing parts.
- Add cockpit themes for the named friends/drivers.
- Make garage color selection affect the real race car and expose all five
  team color pairs.

## Entry Points

- Technical handoff: [`docs/F1-RACER-WIKI.md`](../../../docs/F1-RACER-WIKI.md)
- Development procedure: [`docs/procedure.md`](../../../docs/procedure.md)
- Architecture page: [architecture.md](architecture.md)
- C4 model — game and multiplayer: [c4-model.md](c4-model.md)
- C4 solo/local — levels 1 to 4: [c4-local.md](c4-local.md)
- C4 multiplayer — levels 1 to 4: [c4-multiplayer.md](c4-multiplayer.md)
- Decisions page: [decisions.md](decisions.md)
- Agent bots — browser vs headless, usage: [agent-bots.md](agent-bots.md)
- Roadmap page: [roadmap.md](roadmap.md)
- Developer tooling / publishing workflow: [tooling.md](tooling.md)
