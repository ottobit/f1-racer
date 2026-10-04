# AI, qualifying and race systems

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## 8. AI

AI cars currently have:
- acceleration;
- maximum speed;
- steering/turn rate;
- damage;
- DRS;
- tyre grip;
- caution speed multiplier;
- collision avoidance.

The controller now has three layers:
1. preview the centerline and estimate upcoming corner severity;
2. choose a dynamic lookahead and a racing-line offset;
3. use a corner-speed target to brake before bends and accelerate once the preview clears.

Traffic is also considered tactically:
- a nearby car ahead can trigger a passing-side line;
- a nearby car behind can trigger a defensive line;
- the existing short-range collision avoidance remains as a safety layer.

### Current limitation

AI is now a lightweight racing controller, but it is not yet a full driver model. It does not simulate explicit tyre temperature, individual driver error profiles, multi-lap strategic decisions, or a detailed overtaking state machine.

Those are future refinements for the race-systems phase.

## 9. Qualifying

Qualifying is a solo session.

The player can complete multiple laps and the best completed lap is retained.

AI qualifying times are synthesized from track length, AI top speed and controlled variance rather than simulated in real time.

The resulting order is applied to fixed physical grid slots.

## 10. Race systems

Already present:
- standing start;
- laps;
- race classification;
- championship points;
- DRS;
- tyre grip/wear representation;
- damage;
- track-limit penalties;
- caution state;
- ghost lap;
- minimap;
- camera modes.

The current race is intentionally lightweight and browser-friendly.

## 12. Ghost lap

The player's best lap is sampled approximately every 100 ms.

Samples contain:
- time;
- x;
- z;
- heading.

The best lap is persisted in `localStorage` per circuit and replayed against the current lap clock.

This is a useful foundation for future delta/ghost features.

## 16. Championship and persistence

`core/client/shared/championship.js` stores championship progress/results locally.

The race reports final classification and points, then determines the next unraced circuit.

This means the game remains fully client-side.
