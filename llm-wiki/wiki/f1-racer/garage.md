# Garage setup

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## Garage setup

`garage.html` + `core/client/garage/garage.js` provide an interactive Three.js setup bay with a 360° rotatable open-wheel car. Components can be mounted by drag-and-drop or click/tap. `core/client/shared/garage-setup.js` is the shared data/physics contract and persists the setup under `f1racer-garage-v1`.

Five component families each expose three trade-off variants: front wing, rear wing, floor/diffuser, brakes and suspension. The setup produces modifiers for speed, downforce, braking, stability, traction and runoff behaviour. `core/client/race/main.js` reads these modifiers at race startup, so Garage choices alter actual race physics rather than only UI stats. Front/rear wing choices also alter the Garage car geometry for immediate visual feedback.

Each circuit carries a data-driven recommended setup and a short rationale.
The selected carousel circuit is persisted and passed into the Garage, which
compares all five current components with the recommendation. Applying the
preset is explicit; manual tuning remains free.
The five live setup parameters are rendered as a compact translucent overlay on
the car stage, with label, bar and numeric value, rather than consuming vertical
space in the scrolling component panel.
