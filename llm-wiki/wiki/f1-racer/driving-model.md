# Driving model

The arcade model with a light dynamic layer is shared by the race and free
drive (`setupPlayerPhysics`).

## Player physics (`core/client/race/player-physics.js`)

`integratePlayerMotion(dt)` runs every frame.

**Longitudinal.**
- Throttle, brake/reverse and coasting each have their own rate.
- The top speed is reduced by damage and caution, and raised by DRS/ERS.

**Steering.**
- Keyboard steering is digital. Touch and motion steering are analog
  ([hud-camera-mobile.md](hud-camera-mobile.md)).
- Steering authority falls with speed and scales with tyre grip.

**Dynamic layer.**
- Lateral velocity and finite yaw response are explicit.
- Cornering is grip-limited, and excess lateral motion feeds a corner-drag
  penalty.

**Combined grip.**
- Lateral demand uses up part of the longitudinal grip, so braking or
  accelerating while turning is weaker.
- Simplified load transfer sharpens the front under braking and dulls it
  under power. This gives understeer and oversteer tendencies and makes
  trail braking matter.

**Garage modifiers.** Garage choices are layered onto the base constants.
See [garage.md](garage.md).

Not modelled: tyre slip angle, real load transfer, a rigid body.

## Track limits (`race/race-rules.js`)

- `applyTrackBoundary()` adds progressive runoff drag once the car leaves
  the asphalt and kerbs.
- The runoff stays drivable: there is no snap-back and no zero-speed wall.
  The off-track crawl floor (`crawlSpeed`, ~29 km/h) is the same for the
  player and the AI.
- A hard stop belongs only to explicit barrier geometry, not to distance
  from the centerline.

## DRS, tyres, damage (`race/race-rules.js`, `race/race-systems.js`)

- **DRS** is automatic and gap-based. It raises the top speed when the car
  is eligible.
- **Tyres.** `tireGripFactor()` returns the grip from compound and wear.
  Each compound has its own life, and wet grip is lower. There is no
  temperature or pressure.
- **Damage.** Hard impacts add damage, and damage lowers the effective top
  speed. Car-to-car contact is described in
  [race-systems.md](race-systems.md#contacts).
