# Driving model

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## 5. Current driving model

Player movement is currently concentrated in `integratePlayerMotion(dt)`.

### Longitudinal behaviour
- throttle increases speed using `CAR.accel`;
- brake/reverse uses `CAR.brakeDecel`;
- coasting uses `CAR.coastDecel`;
- speed is clamped to forward/reverse limits;
- maximum speed is affected by damage, DRS and caution state.

### Steering
- keyboard steering is digital;
- touch steering is analog;
- steering authority decreases with speed;
- tyre grip multiplies steering authority;
- heading is directly integrated from steering input.

### Track interaction
`applyTrackBoundary()` applies progressive runoff drag once the car leaves the asphalt/kerb edge. Runoff remains traversable: it slows the car without snapping it back to an invisible track-width boundary or reducing momentum to zero. Hard collision behaviour should be tied to explicit physical barrier geometry rather than generic distance from the centerline.

### Current limitation
The model now has a lightweight dynamic layer: explicit lateral velocity, finite yaw response and grip-limited cornering. Excess lateral motion feeds a corner-drag penalty into longitudinal speed. This is still an arcade-oriented model rather than a full tyre-force simulation; explicit slip-angle/load-transfer modelling remains a future refinement.

## Evolved driving dynamics

Player physics uses a lightweight combined-grip model rather than independent steering/throttle/brake channels. Lateral demand consumes part of the longitudinal grip budget, so braking and accelerating while cornering are less effective. Simplified longitudinal load transfer sharpens front response under braking and reduces it under power; lateral recovery is progressive and rear stability changes with braking/throttle. This produces controllable understeer/oversteer tendencies, trail-braking consequences and cleaner-exit rewards without a full rigid-body tyre simulation. Garage modifiers remain layered into the base car constants.

## 11. DRS / tyres / damage

### DRS
DRS modifies maximum speed when the current eligibility logic permits it.

### Tyres
Tyre grip is exposed through `tireGripFactor()` and affects driving behaviour. The system is currently a simplified grip model rather than a full compound/temperature/pressure simulation.

### Damage
Hard impacts increase damage and reduce effective maximum speed.
