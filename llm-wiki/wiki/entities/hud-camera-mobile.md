---
type: entity
updated: 2026-10-04
sources: []
---

# HUD, input, camera and mobile

## HUD (`core/client/race/race-hud.js`)

- **The top HUD panel stays as it is** unless the user asks otherwise
  (constraint in [architecture.md](../synthesis/architecture.md#constraints)).
- Top-centre instrument cluster: shift LEDs, DRS/ERS, speed bar, gear and
  speed readout. It sits in the forward sight line, away from the touch
  controls. There is no analog dial.
- Other HUD items:
  - circuit, position, lap, lap times;
  - tyre grip, damage, caution;
  - penalty notice;
  - minimap.
- In qualifying only the countdown shows at the top. The phase banner is
  hidden to keep the view clear on landscape phones. The top-right summary
  shows the lap time and the provisional grid position.
- Timing tower:
  - it shows on landscape only and has no panel;
  - it lists the qualifying times, then the live race order, with the
    player highlighted;
  - in multiplayer it also shows voice icons ([c4-voice.md](../comparisons/c4-voice.md)).

## Input (`race/race-input.js`, `race/steering.js`)

- Keyboard: arrows or WASD. `C` switches between chase and cockpit camera.
- Touch:
  - gas and brake are separate pedals;
  - the analog wheel uses pointer capture and reads horizontal travel from
    where the thumb lands;
  - only one pointer owns the wheel;
  - capture loss, blur or backgrounding clears what is held;
  - the wheel's hit area is 184 px, 164 px in compact landscape and 168 px on
    very narrow screens.
- `steering.js` holds the pure maths: dead zone, exponential smoothing and a
  speed-sensitive yaw target. Yaw is zero at zero speed and reverses in
  reverse gear.
- Motion steering is opt-in from the lower controls:
  - hold the phone steady for 500 ms to set neutral; `Centra` recalibrates;
  - roll in the screen plane compensates for pitch;
  - an almost flat screen prompts the player to lift the phone;
  - there are three sensitivity choices;
  - no sensor listener runs before consent;
  - stale data, rotation or backgrounding fall back to touch;
  - touching the wheel takes over at once.
  It still needs a check on real iOS and Android phones.
- Gesture and zoom guards are on: `touch-action: none` on gameplay surfaces,
  plus iOS gesture and double-tap guards. Links keep working normally.
- Lower controls are styled in `race/race-controls.css`.

## Camera (`race/race-camera.js`)

- **Chase:**
  - it follows behind the player, with FOV that grows with speed;
  - base distance is 6.4 units, capped at 5.2 in compact landscape;
  - the camera position is clamped to the track-and-runoff corridor, so it
    never sits behind scenery.
- **Cockpit:**
  - the camera is fixed to the car;
  - the player's car is hidden;
  - it draws a themed overlay ([car-rendering.md](car-rendering.md));
  - road cars set their own `cockpitEye`.
- Impacts shake the camera.
