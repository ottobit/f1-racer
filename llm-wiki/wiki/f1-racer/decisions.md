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

The home keeps browser page zoom enabled (accessibility), but its controls use
`touch-action: manipulation` so quick repeated taps on carousel arrows/dots
never trigger double-tap zoom, and the carousel viewport allows `pinch-zoom`
alongside `pan-y` so a zoomed page can always be pinched back out (#32: with
`pan-y` alone the carousel, ~70% of a phone screen, trapped users zoomed in).

The home prioritizes actions over reference data. Difficulty and driver live
in one session-setup panel, and standings follow the circuit carousel instead
of interrupting the path into a race.

**#40 superseded this section's original pairing.** Garage and solo circuit
selection were the two dominant commands until #40: the user's explicit call
was that multiplayer (playing with other real people) is the more important
thing to grow, and deserves the same visual weight as Garage, not a secondary
banner (#36's original placement). Garage and **multiplayer** (`room.html`)
are now the two `home-command` cards. The user then asked to drop the solo-
play shortcut entirely rather than demote it to a secondary link — there is
no dedicated "jump to circuit selection" entry point left above the fold;
solo play is still fully reachable by scrolling to its own numbered section
further down the page, just not called out separately at the top. If this
gets revisited, don't silently restore either the pairing or the shortcut —
re-confirm with the user first, since these were deliberate product priority
calls, not layout preferences.

**#38 correction:** the two `home-command` cards and the numbered `f1-home-
section`s (Prepara la sessione / Prossima gara / Campionato) are two
different index systems that happened to both look like "0N" labels,
reading as one broken sequence instead of two intentional ones. Fixed by
dropping numerals from the top command cards (PIT LANE / GRIGLIA, no
number — they're primary actions, not steps) and renumbering the page
sections 01→03 with no gaps. The multiplayer banner got an explicit
"Modalità alternativa" kicker instead of no label, so it reads as a
deliberate parallel path rather than an afterthought wedged between
sections. The session-setup panel (difficulty + driver) stacks vertically
on all viewports now, not just mobile — side-by-side on desktop left a
visible empty gap under the 3-option difficulty column next to the taller
10-option driver grid.

## Multiplayer Stage 1 (#36, part of #1)

Stage 1 is rooms and driver reservation only — race-state sync and voice are
separate future issues, deliberately not designed here, each with their own
infra/protocol decisions #1 itself demands be made before implementation.
`startRace()` sets a shared "started" confirmation and stops there on
purpose; it must not be extended into car/position sync without that being
its own decision.

Starting a room's race is host-only for Stage 1. Chosen as the simplest rule
that avoids a race (pun intended) between two participants both hitting
start, not because "all-ready" was ruled out — revisit if it feels wrong
once real rooms are used.

Room/participant state is in-memory only, one process, no database — a
deliberate Stage 1 scope limit given hosting itself was still an open
question, not an oversight. State resets on server restart; this must stay
true and documented, not quietly fixed with a database later without saying
so.

Room identity (`f1racer-room-session-v1`) and solo-play identity
(`driver-selection.js`'s `f1racer-selected-driver-v1`) are deliberately
independent — the local-only `"player"` pseudo-id must never become a valid
room `driverId`, and joining/leaving a room must never alter the solo
flow's own saved driver choice.

Hosting for when Stage 1 goes live: the user picked **Render** (prior
experience with it) over Fly.io's cheaper always-on pricing, with a
self-ping to dodge the free tier's 15-minute sleep. Flagged, not
overridden: a self-pinged 24/7 service uses close to Render's free-tier
monthly instance-hour allowance on its own, so it may need the paid Starter
tier depending on what else runs on the same account — the user's call, not
this repo's to solve.

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

There is no Garage livery picker (#30, user request): the player's car wears
the chosen driver's team colours, like the AI teammate, with Fenice as the
fallback. The Garage is for setup, identity comes from the driver choice.

On wide screens live setup parameters sit on the car preview as a compact
translucent overlay. On phones (portrait, and landscape up to 520px tall) they
move into the setup pane as a card, because the overlay covered most of the car.
Portrait phones use a single page scroll with the car pinned on top and the
"Scegli il circuito" CTA pinned at the bottom — no nested scroll box. Landscape
phones use two columns (car left, scrolling pane right). Variant labels are
Italian (Scarica/Bilanciata/Carica, Basso/Alto carico).

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
Since #28 this applies to every circuit, and to guardrails too: the user
described the old per-segment boxes as "sembra che stai giocando a fare i
collage". Road-hugging strips are built from `offsetEdge()` (miter-cut at
tight apexes) on a denser render-only sampling; gameplay keeps the
360-sample centerline.
