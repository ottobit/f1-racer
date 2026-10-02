# Raw discussion — "System One" decision models (Jev, nimble), 2026-10-01/02

Raw, unsynthesized notes from a chat between the user and the agent, kept
for later ingest into `llm-wiki/wiki/`. The synthesized parts already live in
[the Jev source note](../2026-10-01-ollama-jev-decision-models.md) and in
`wiki/f1-racer/agent-bots.md` ("Local decision models", #307). Tags as in the
chat: **[Certain]** = evidence, **[Probable]** = strong inference,
**[Hypothesis]** = filling gaps.

Access limits during the discussion: the cloud container's proxy blocks
`ollama.com`, `registry.ollama.ai`, GitHub release downloads and most press
sites, and the container has no GPU. Evidence came from the Ollama source
(clone at `1abe35e`), raw GitHub READMEs and search snippets. Nothing was run.

## 1. What a "System One" model is

- [Certain] Not a new model class. "System One" is a marketing label borrowed
  from Kahneman (System 1 = fast/intuitive, System 2 = slow/reasoned).
  Underneath is an ordinary LLM used as a **classifier**.
- [Certain] Mechanism (`decision/systemone.go`):
  1. prompt = `{"context": state, "schema": [all questions]}` +
     `Requested field: "<name>"`, rendered with the model's chat template,
     thinking off;
  2. the allowed answers become single-letter codes A..Z;
  3. **one prefill pass, no generation**: Ollama reads the next-token logits
     of those letters;
  4. softmax → probabilities; `confidence = 1 − entropy / ln(n)`;
  5. repeated once per question, each time re-sending the whole state.
- Comparison with a chat LLM:

  | | Chat LLM ("System 2") | System One |
  |---|---|---|
  | Output | text, token by token | distribution over fixed options |
  | Passes | prefill + N generated tokens | prefill only |
  | Off-schema answers | possible (needs parsing) | impossible by construction |
  | Reasoning | can "think aloud" | none — intuition only |
  | Cost grows with | answer length | state size × number of questions |

- [Probable] `nimble` (9B, Bespoke Labs) and `tev1` (0.8B/4B, Together AI)
  are decoder LLMs fine-tuned on Jev's prompt format, hence the `decision`
  capability gate. A generic model would answer with poorly calibrated
  probabilities.
- [Certain] Same task, different architecture: Laya = ModernBERT encoder +
  decision head (32 ms in pacman-arena, but it played worst).
- [Probable] The technique (LLM logprob classification) is old; what is new
  is the package: trained models, calibrated probabilities, a standard local
  endpoint. It is a generalist classifier, not something that "understands"
  a race.

## 2. Who provides the options

- [Certain] **The caller's code**, in each question's `criteria`. The model
  never invents options; it only picks among the letters it is given.
- Two kinds:
  - **fixed**: decided once (`left/right/follow`, `box/stay`), as in the
    car-dodging demo;
  - **generated per call**: code enumerates and pre-evaluates candidates each
    step, as in Pac-Man (candidate paths with pellets and ghost distance
    already computed).
- [Probable] The better the code describes the options, the less the model
  adds. That is why the greedy heuristic won at Pac-Man.
- In f1-racer: `room-bot` (or a new Node module) would build state + options
  from `getState()`, call the model, and execute the choice via the driver.

## 3. Marketing claims vs evidence

- **Pac-Man** ([pacman-arena](https://github.com/hakan-gecili/pacman-arena),
  30 seeds, Ollama 0.35, Apple M4 Max) [Certain, from its README]:

  | Model | Boards cleared | Lives lost / 100 steps | Median decision | Time per game |
  |---|---|---|---|---|
  | tev1:4b | 27/30 | 0.26 | 384 ms | 39.5 s |
  | nimble | 28/30 | 0.22 | 668 ms | 66.4 s |
  | Laya | 0/30 | 1.05 | 32 ms | 4.7 s |
  | greedy (no model) | **30/30** | **0.08** | – | 0.5 s |

  - The game builds the candidate paths; the model returns one letter.
  - The authors themselves say the models "add latency without improving"
    on the heuristic.
  - [Probable] The game waits for the model (turn-based), so "plays in real
    time" holds only with a paused or slowed game.
- **Car dodging** (Ollama video, known only via GIGAZINE / press)
  [Probable]:
  - discrete "left or right" lane choices, where the game executes the lane
    change;
  - not continuous driving. The 91 ms/decision figure is `nimble` on an
    M5 Max, with a small state.
- [Certain] 91 ms does not transfer: the pacman-arena median was 4–7× that
  with a bigger state.

## 4. Fit with f1-racer

- [Certain] **No steering/throttle.** At 60 fps a 400–700 ms decision is
  25–40 frames late, and multiplayer races cannot pause for the model.
- [Probable] **Overtake/dodge side** (`left/right/follow`) is the most
  plausible fit: discrete, 3–10 Hz, with the layered driver executing the
  manoeuvre.
  - Needs a tiny state (5–6 numbers), one question and a real GPU.
  - Kill criterion: p95 > ~150 ms → useless for dodging (200 ms at
    250 km/h ≈ 14 m late).
- [Probable] **Slow tactical layer** (pit now / mode / pace every 0.5–2 s)
  fills the VSN2 gap where the agent stopped deciding. The agent sets the
  questions and thresholds; `pit:true` is gated by `pit none`/`armed`.
- [Hypothesis] As at Pac-Man, our heuristics (layered driver, tactics
  #228–#229) will likely beat the model. Look for a choice where the
  heuristic is weak, such as box timing with wear + damage + traffic.
- [Hypothesis] Hardware: the user's GT 640 cannot run `nimble` 9B usefully
  (mostly CPU → seconds); `tev1:0.8b` might work and must be measured. CPU
  contention with 5 Chromium bots is already suspected in VSN2.
- Runs Node-side on the player's PC (`localhost:11434`), never in the GitHub
  Pages client (players have no Ollama; CORS needs `OLLAMA_ORIGINS`).

## 5. Test call to run on the PC (not run yet)

`ollama pull nimble` (Ollama ≥ 0.35, ~9–10 GB), then:

```bash
curl -s http://localhost:11434/v1/systemone -H "Content-Type: application/json" -d '{
  "model": "nimble",
  "state": {
    "speedKmh": 265, "gapAheadM": 14,
    "carAheadSide": "slightly right of centerline",
    "trackRoomLeftM": 3.0, "trackRoomRightM": 1.2,
    "nextCorner": "left-hander in 180 m", "tyreWearPct": 62
  },
  "questions": {
    "move": {
      "type": "choice",
      "instructions": "You drive the car. Pick the safest way past the car ahead.",
      "criteria": {
        "left": "pass on the left side",
        "right": "pass on the right side",
        "follow": "stay behind, no overtake"
      }
    },
    "pit_now": { "type": "noul", "instructions": "Should the car pit this lap?" }
  }
}'
```

- Expected shape (from the code; values made up):
  `{"answers":{"move":{"type":"choice","choice":"left","probabilities":{...},"confidence":0.47},"pit_now":{"type":"noul","noul":0.38}},"usage":{...}}`
- The scenario is built so the right answer is `left`: car ahead to the
  right, room on the left, left-hander coming.
- Run it twice: the first call includes model load.
- Record the answers and the latency, then try `tev1:0.8b` with one
  question and a 5–6 number state.
- In PowerShell, `@{}` hashtables don't keep the order of `criteria`
  (letters may shuffle). That is harmless here.

## Open

- Real latency (median/p95) on the user's PC for `nimble` and `tev1:0.8b`.
- Zero-shot quality on racing state.
- Offline comparison, pacman-arena style: recorded `state.json` → "box
  now?" from the model vs the current rule vs the race outcome.

## Sources

- https://ollama.com/blog/ollama-now-supports-jev-style-decision-models (not readable from the container)
- https://github.com/ollama/ollama (`decision/`, `server/routes.go`, `1abe35e`)
- https://github.com/hakan-gecili/pacman-arena
- https://github.com/grapeot/decision-pacman
- https://docs.ollama.com/capabilities/decision
- https://gigazine.net/gsc_news/en/20261001-ollama-jev-style-decision-models/
- https://modelsystem.one/news/ollama-systemone-decision-models/
- https://sotaaz.com/post/ollama-decision-models-en
- https://runtimewire.com/article/ollama-local-decision-models-systemone
