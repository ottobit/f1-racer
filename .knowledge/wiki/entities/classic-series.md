---
type: entity
updated: 2026-10-04
sources: []
---

# Classiche series

Solo races with period road cars instead of F1s (#317, `?series=classic`).

## Entry and storage

- Home's driver card is a two-page swipe: F1 · Classiche (`home/menu.js`).
- A Classiche pick saves `f1racer-series=classic` and the driver
  (`f1racer-classic-driver`).
- The launch link becomes `race.html?...&series=classic`, with the button
  "CLASSICHE →".
- Without `series` the race runs as the F1 series.

## Code

- **`core/client/shared/series.js` (#341):** `ClassicSeries extends Series`.
  `race/main.js`, `home/menu.js` and `garage/garage.js` ask the series and
  never branch on `"classic"`. The series answers:
  - the vehicle and colours;
  - the rivals;
  - the driver names;
  - the race title;
  - `drsErs: false`;
  - the championship.
- **`core/client/shared/classic-series.js`:** `CLASSIC_ROSTER`, 12 drivers
  with their own colours, plus storing the selected driver.
- **One-make (#321):** every rival drives the player's car, each in its own
  colours.
- **Rival settings (#349):** rivals use the car's `stockParams(isRaining)`,
  with no garage setup and no tuning against the player's laps
  (`race/rival-ai.js`).
- **Player:** uses `playerParams(isRaining, garage)` with the road garage
  (`shared/road-garage.js`, `garage/road-garage-ui.js`, #323):
  - tyres, gearing, brakes, suspension and paint;
  - saved under `f1racer-road-garage-v1`.
- **Qualifying:** one simulated flying lap per car.
- **DRS and ERS:** forced off every frame and hidden
  (`html.series-classic`).
- **Engines:** each car has its own engine sound ([audio.md](audio.md)).
- **Championship:** `SERIES.classic.championship` (#345), kept separate from
  the F1 one.
- **Multiplayer rooms:** always `SERIES.f1`.

## Open

Rivals have no setup, while the player has one. A "rivals with setup" cycle
(Cycle D) is planned but not built.
