# Classiche series

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## Classiche series (`?series=classic`, #317)

Solo races with period road cars instead of F1s. Home's driver card is a
two-page scroll-snap swipe (F1 · Classiche, `menu.js`); a Classiche pick
saves `f1racer-series=classic` and `f1racer-classic-driver`, and the circuit
link becomes `race.html?...&series=classic` ("CLASSICHE →").

- `shared/classic-series.js`: `CLASSIC_ROSTER` (12 drivers, 2 per car, own
  colours), series and driver storage.
- `race/main.js`, behind `CLASSIC` (false in multiplayer): the player drives
  `buildRoadVehicle(driver.car)` with that car's `params()` (rain penalties,
  no garage effects); the eleven rivals are the other classic drivers, each
  with `classicAiParams(car)` (the F1's AI/player ratios) on `car.ai`, which
  `race-ai.js` prefers over the shared limits. Qualifying simulates one
  flying lap per kind of car. DRS/ERS are forced off every frame and hidden
  (`html.series-classic`). Names come from the classic roster. Results score
  into the Classiche championship (`SERIES.classic.championship`, #345),
  separate from the F1 one.
- Without `series` the race is unchanged.
