# HUD, input, camera and mobile

> Moved from `docs/F1-RACER-WIKI.md` (#365). Index: [index.md](index.md).

## 13. HUD and input

HUD currently exposes:
- circuit;
- position;
- lap;
- current lap time;
- best time;
- speed;
- speed bar;
- gear;
- shift LEDs;
- DRS;
- tyre grip;
- damage;
- caution;
- penalty notification;
- minimap.

The main gear/speed instrument cluster (shift LEDs, DRS/ERS, speed bar, gear and speed readout) is positioned at the **top center** of the viewport, keeping it in the forward sight line and away from the bottom-corner touch controls.

Qualifying keeps only its countdown in the upper HUD. The phase banner and
label are intentionally omitted to preserve the forward view on landscape
phones. The compact center instrument cluster uses the original speed bar and
digital readout without an analog dial.

Input:
- Optional phone motion steering: activate from the lower controls, hold the
  phone steady for 500 ms to average neutral. Screen-plane roll compensates
  pitch; nearly horizontal screens prompt lifting the phone. SX/DX feedback
  shows actual smoothed steering, and mode changes preserve pedal holds.
  Then hold the
  comfortable neutral position, then use Centra to recalibrate. Three sensitivity
  choices share the existing steering dead zone/smoothing. Touching the wheel
  immediately restores touch steering. No sensor listener runs before consent;
  missing/stale data, screen rotation or backgrounding restores touch controls.
  Verify direction and feel on physical iOS/Android devices before claiming
  device compatibility; structural checks cannot establish sensor behavior.
- Arrow keys / WASD;
- touch gas/brake;
- analog touch steering wheel;
- C toggles chase/cockpit camera.

## 14. Camera

Two modes currently exist:

### Chase
Third-person camera follows behind the player, with speed-dependent FOV.
Its desired position is constrained to the track-and-runoff corridor so tight
corners cannot place the camera behind scenery. Compact-landscape framing keeps
enough distance and height to show the rear of the player car.

### Cockpit
First-person camera is attached directly to the car.

The player's visual car is hidden in cockpit mode.

## 17. Mobile

Touch controls are implemented in `core/client/race/main.js` and styled in `core/client/style.css`.

On the race page, browser zoom/gesture handling is explicitly suppressed for gameplay surfaces on touch devices. CSS `touch-action: none` is combined with iOS Safari gesture-event and rapid-double-tap guards, while normal link interaction remains available.

The steering wheel uses pointer capture and an analog horizontal position rather than two binary left/right buttons.
Its touch surface is 184 px in ordinary mobile layouts, 164 px in compact
landscape and 168 px on very narrow screens, while the upper HUD is unchanged.

This is important to preserve when refactoring input.

## Camera, race completion, collisions and Garage coherence

The chase camera uses a materially close base framing (6.4 units, capped at 5.2 on compact landscape) while remaining inside the track corridor. Race completion is gated by validated completed laps: a lap requires reaching the opposite half of the circuit and then crossing the painted start/finish line forward; raw accumulated progress alone can no longer trigger the results overlay. Each car's finishing position is locked at that crossing, so cars that have already finished cannot distort the result by continuing to accumulate distance. Car-to-car contacts use overlap correction plus relative closing velocity along the contact normal instead of multiplying both cars' speed on every overlap, reducing repeated bouncing and sticky side contact.

The Garage renders the same procedural F1 car construction used by the race branch, including the richer modern-F1 visual cues. Five labelled mounting zones make the drag target explicit and only the matching zone highlights during a drag; tap/click remains the mobile fallback.
