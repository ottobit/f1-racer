# F1 Racer Decisions

## Development Flow

All changes should go through issue, branch, pull request and merge. The current
default verification mode is structural-only: `git diff --check`, syntax checks
and other cheap targeted checks. The user validates gameplay manually unless
extra runtime/browser testing is explicitly requested.

## Visual Direction

The race and garage should feel more spectacular than the original prototype,
using Three.js lighting, procedural detail and motion where possible while
remaining browser-friendly.

The top race HUD is liked by the user and should be preserved.

Session clarity is provided outside that HUD: qualifying uses a dedicated,
mobile-visible banner with its countdown and grid-purpose text, hidden when the
race begins.

## Controls

Touch controls must be sized and spaced for real thumbs. Steering should remain
analog and visually readable, and front wheel visuals must follow steering in a
mechanically plausible way.

The race steering surface stays at least 164 px across on supported mobile
layouts. The visible driver's gloves sit on a modeled steering wheel, and that
assembly rotates from the same analog value as the front wheels.

## Home and Circuit Selection

Circuit selection uses one large map-led carousel instead of equally weighted
cards. Swipe, visible arrows, keyboard arrows and dot controls all update the
same selected circuit. The launch action stays inside the active slide and all
mobile controls keep thumb-sized targets.

Only `Scendi in pista` inside the active circuit slide starts a race. The rest
of the card is presentation and swipe surface, avoiding competing launch
buttons and accidental navigation while browsing circuits.

Swipe capture applies only to touch/pen input that starts outside the race CTA.
Mouse input uses the carousel arrows and must never enter pointer capture, so
desktop activation of `Scendi in pista` remains a normal link click.

The home prioritizes actions over reference data. Garage and circuit selection
are the two primary commands directly below the hero, with Garage visually
dominant. Difficulty and driver live in one session-setup panel, and standings
follow the circuit carousel instead of interrupting the path into a race.

Inside session setup, difficulty is a three-segment choice with short intent
labels. Driver selection is a numbered 3-column touch grid on ordinary phones
and falls back to 2 columns on very narrow screens. Targets remain at least
54 px high and the selected state uses more than color alone.

## Collision Fairness

Player and AI cars have equal mass in car-to-car contact. Relative velocity is
resolved along the contact normal, both cars receive lateral/yaw disturbance,
and damage is applied symmetrically above a minimum impact speed. Contact
effects have a short cooldown to avoid repeated damage while cars separate.

## Garage UX

The car preview must stay visible while the player scrolls through selectable
parts. Choosing a part should immediately show a meaningful preview on the car.

Garage livery selection is real state, not a temporary preview. The five team
color pairs are persisted in `f1racer-garage-v1` and applied to the player car
at race startup.

The selector belongs at the top of the scrollable setup panel. On mobile this
keeps the control discoverable and gives every option a thumb-sized target
without taking space away from the fixed car preview.

Live setup parameters belong on the car preview as a compact translucent
overlay. The scrolling panel is reserved for recommendations and component
choices; each overlaid parameter includes its label, bar and numeric value.

The Garage showroom has no driver model. Removing the helmet must reveal a
modeled cockpit rather than an empty dark cavity; the dedicated `Abitacolo`
camera preset makes that interior inspectable.

Garage camera presets must remain inside the modeled studio shell. In
particular, rear-facing views cannot orbit beyond the back wall at z=-8, because
the opaque backdrop would sit between the camera and the car.

Team sponsorship is fictional and livery-driven. Both drivers in a team share
the same restrained sponsor package, limited to small sidepod, nose and rear
wing placements so the base paint remains dominant.

Lap timing and race completion must use the painted start/finish line, not the
unshifted spline origin. Finish order is locked per car at the configured race
distance. AI cars must not perform invisible stops on the racing surface; an
automatic AI pit strategy can return only with a modeled pit lane.

## Driver Names

The custom friend names currently assigned across teams are:

| Team | Drivers |
| --- | --- |
| Fenice | Dani Muscle, Eddy Nitro |
| Nettuno | Vivian Wendy, Peppy Bau |
| Solare | Cookie, Rocker Pino |
| Smeraldo | Alice AaA, May |
| Artica | Clopy, Lola |

The ten-driver roster is canonical. The selected identity represents the
player and is filtered out before the other nine are created as AI rivals, so a
name cannot appear twice in the same race.

Race drivers must be visible as seated bodies, not floating helmets. Their suit
uses the car's primary livery color, with dark gloves and the existing
secondary-color helmet.

Opponent names use small screen-space labels above visible cars. Labels are
hidden outside the camera frustum and beyond the useful identification range;
the player's own car has no label to preserve the driving view.

Each selectable friend/driver has a cockpit theme with primary, secondary, glow
and short motto values in `driver-themes.js`. Cockpit decoration should stay
data-driven and readable rather than becoming hard-coded camera logic.

The qualifying timing list is landscape-only and sits on the left without an
enclosing panel. Its compact mobile rows stay above the steering control. Rival
times are generated once per session and shared by the list and grid
calculation; never resynthesize them when qualifying ends.
At race start the tower switches to the live order returned by
`currentRaceOrder()` and rerenders only when order or displayed lap changes.
Equal progress during the standing start is resolved by the qualifying grid
position; the player's qualifying summary must state that position explicitly.

Marzamemi is an adapted real route, not a literal GIS import. The shared-road
legs visible in the reference are separated into parallel spline segments so
the ribbon, AI and wall-distance model remain valid. Its scenery must use the
dedicated coastal theme and instancing, with standard red/white racing kerbs.
The user rejected rounded end loops: preserve the map angles using close
corner supports and per-circuit spline tension (0.18 for Marzamemi).
Marzamemi's kerbs use continuous ribbons aligned with the actual road edge,
not disconnected boxes. Paint stripes follow distance along each edge and
close seamlessly; geometry and texture are created once at scene setup.
