# F1 Racer solo/local — C4 levels 1 to 4

> Current architecture. This model follows one solo player from the published
> site down to the JavaScript modules that update the car every frame.

## Visual legend

```mermaid
flowchart LR
  person["Person"]:::person
  system["System / container"]:::container
  component["Component / code"]:::component
  data[("Data store")]:::data
  external["External dependency"]:::external
  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef component fill:#438dd5,color:#fff,stroke:#246b9e
  classDef data fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef external fill:#666,color:#fff,stroke:#444
```

## C4 Level 1 — System context

The local product is a browser game. The player never needs the multiplayer
server: all simulation and persistence required for solo play live on the
device.

```mermaid
flowchart LR
  player["Player<br/>Chooses a driver, setup and circuit;<br/>drives qualifying and the race"]:::person

  f1["F1 Racer — solo system<br/>Static 3D browser game with garage,<br/>championship, AI grid and local progress"]:::container

  pages["GitHub Pages<br/>Publishes the static application"]:::external
  cdn["jsDelivr<br/>Delivers Three.js 0.160.0"]:::external

  player -->|"Touch, keyboard, gamepad or gyroscope"| f1
  pages -->|"HTML, CSS, JS and images over HTTPS"| f1
  cdn -->|"Three.js ES module"| f1

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef external fill:#666,color:#fff,stroke:#444
```

### Context boundary

- No login or remote profile exists.
- No application backend participates in a solo session.
- GitHub Pages and jsDelivr deliver code; they do not receive gameplay state.

## C4 Level 2 — Containers

The static files become one executable browser container after loading. The
only application data store is the browser's own `localStorage`.

```mermaid
flowchart TB
  player["Player"]:::person

  subgraph f1["F1 Racer — local runtime"]
    web["Browser application<br/>HTML + CSS + ES modules + Three.js<br/><br/>Home, garage, qualifying, race,<br/>AI, rendering, audio and controls"]:::container
    storage[("Browser localStorage<br/><br/>Selected driver/circuit/difficulty,<br/>garage setup, graphics profile,<br/>championship and lap ghost")]:::data
  end

  pages["GitHub Pages<br/>Static hosting"]:::external
  cdn["jsDelivr<br/>Three.js CDN"]:::external
  device["Device APIs<br/>WebGL, Audio, Pointer, Keyboard,<br/>Gamepad and DeviceOrientation"]:::external

  player -->|"Uses"| web
  pages -->|"Loads application"| web
  cdn -->|"Loads renderer library"| web
  web <-->|"Reads and writes synchronously"| storage
  web <-->|"Uses browser capabilities"| device

  classDef person fill:#08427b,color:#fff,stroke:#052e56
  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef data fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef external fill:#666,color:#fff,stroke:#444
```

### Container contract

The browser owns the entire local consistency boundary: input, simulation,
rendering, qualifying, grid synthesis, race result and championship update are
committed in the same JavaScript runtime.

## C4 Level 3 — Browser components

```mermaid
flowchart TB
  subgraph navigation["Navigation and preparation"]
    home["Home and circuit selection<br/>home/menu.js"]:::component
    garage["Garage and showroom<br/>garage.js + showroom.js"]:::component
    domain["Shared domain<br/>circuits, roster, themes,<br/>setup and championship"]:::component
  end

  subgraph race["Race runtime"]
    boot["Race bootstrap<br/>race-bootstrap.js"]:::component
    main["Race orchestrator<br/>race/main.js"]:::container
    input["Input and steering<br/>race-input.js + steering.js"]:::component
    simulation["Simulation<br/>player-physics, collisions,<br/>AI and driver providers"]:::component
    session["Session and race systems<br/>progress, tyres, DRS, damage,<br/>pit, brake map and commands"]:::component
    presentation["Presentation<br/>track/car view, HUD, camera,<br/>audio, weather and effects"]:::component
  end

  storage[("localStorage")]:::data
  three["Three.js"]:::external

  home <-->|"Selection and standings"| domain
  garage <-->|"Setup and livery"| domain
  domain <-->|"Persisted state"| storage
  home -->|"Launch URL"| boot
  garage -->|"Return to selection"| home
  boot -->|"Dynamic import"| main
  main --> input
  main --> simulation
  main --> session
  main --> presentation
  main <-->|"Circuit, driver, setup and result"| domain
  input -->|"Normalized controls"| simulation
  simulation -->|"Car state"| session
  session -->|"World and HUD state"| presentation
  presentation -->|"WebGL scene"| three

  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef component fill:#438dd5,color:#fff,stroke:#246b9e
  classDef data fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef external fill:#666,color:#fff,stroke:#444
```

### Component responsibility rule

`main.js` is the composition root: it constructs the world, owns live state and
connects focused modules through setup functions and callbacks. The focused
modules implement behaviour but do not independently bootstrap the page.

## C4 Level 4 — Race code

The code view focuses on the critical per-frame path rather than showing every
helper function.

```mermaid
classDiagram
  direction LR

  class MainRuntime {
    state
    aiCars
    sessionPhase
    raceState
    animate(now)
    update(dt)
    finishQualifying()
    finishRace()
  }

  class RaceInput {
    input.forward
    input.back
    updateSteeringInput(dt)
    setExternalSteer(value)
  }

  class PlayerPhysics {
    integratePlayerMotion(dt)
    lateralVelocity
    yawResponse
    gripLimit
  }

  class RaceAI {
    updateAiCar(car, dt)
    previewCorner()
    chooseTargetSpeed()
  }

  class RaceSystems {
    updateTyres()
    updateDrs()
    updateDamage()
    updatePitState()
  }

  class RaceProgress {
    advanceProgress(car)
    currentRaceOrder()
    lockFinishPosition()
  }

  class RaceView {
    applyCarToMesh()
    camera.update()
    hud.update()
    renderer.render()
  }

  class SharedDomain {
    CIRCUITS
    DRIVER_ROSTER
    loadGarageSetup()
    recordRaceResult()
  }

  MainRuntime --> RaceInput : reads normalized input
  MainRuntime --> PlayerPhysics : advances player
  MainRuntime --> RaceAI : advances rivals
  MainRuntime --> RaceSystems : updates rules
  MainRuntime --> RaceProgress : updates lap/order
  MainRuntime --> RaceView : projects state
  MainRuntime --> SharedDomain : loads configuration / saves result
  RaceInput --> PlayerPhysics : steer, throttle, brake
  PlayerPhysics --> RaceProgress : position and progress
  RaceAI --> RaceProgress : rival progress
  RaceSystems --> PlayerPhysics : grip and speed limits
```

### Per-frame execution

```mermaid
sequenceDiagram
  participant RAF as requestAnimationFrame
  participant Main as main.animate
  participant Input as race-input
  participant Sim as physics / AI / systems
  participant View as HUD / audio / Three.js

  RAF->>Main: animate(now)
  Main->>Main: frame limiter + dt cap
  Main->>Input: updateSteeringInput(dt)
  Input-->>Main: normalized steer/pedals
  Main->>Sim: update(dt)
  Sim-->>Main: updated player, rivals and session
  Main->>View: update effects, names and camera
  Main->>View: renderer.render(scene, camera)
  Main->>RAF: request next frame
```

## Local deployment

```mermaid
flowchart LR
  repo["GitHub repository"]:::external
  pages["GitHub Pages CDN"]:::external
  browser["Player browser<br/>F1 Racer ES modules"]:::container
  device["WebGL / Audio / input APIs"]:::external
  storage[("Device localStorage")]:::data

  repo -->|"Publish branch root"| pages
  pages -->|"HTTPS static delivery"| browser
  browser <--> device
  browser <--> storage

  classDef container fill:#1168bd,color:#fff,stroke:#0b4884
  classDef data fill:#2e7d32,color:#fff,stroke:#1b5e20
  classDef external fill:#666,color:#fff,stroke:#444
```

## Local architectural consequences

- The game remains playable if the multiplayer service is unavailable.
- Performance and determinism depend on each device/browser.
- Championship and setup cannot follow the player to another device.
- Manual query-string version propagation is part of the deployment contract.
- `main.js` is still the principal coupling hotspot despite the extracted
  modules.

