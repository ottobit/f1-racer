# Source Note: Ollama Jev-style decision models (`/v1/systemone`)

Source: https://ollama.com/blog/ollama-now-supports-jev-style-decision-models  
Primary evidence: Ollama source, https://github.com/ollama/ollama at `1abe35e`
(2026-09-29): `decision/systemone.go`, `decision/types.go`,
`server/routes.go` (`SystemOneHandler`), `types/model/capability.go`.  
Ingested: 2026-10-01

The blog page itself could not be read: `ollama.com` (and the mirrors) are
blocked by the cloud container's egress proxy. Facts below marked *(code)*
come from the Ollama source; facts marked *(press)* come only from search
snippets of secondary coverage (alternativeto, GIGAZINE, LinkedIn, daily.dev)
and are not verified.

## What it is

- Ollama 0.35 adds "decision models" built for TypeSafe's **Jev API**: send a
  text/JSON state plus named typed questions, get typed answers with
  probabilities in one request *(press)*.
- Endpoint `POST /v1/systemone` ("System One": fast intuitive decisions, as
  opposed to an LLM that reasons by generating text) *(code)*.
- Models: `nimble` (9B), `tev1`, `tev1:0.8b` *(press)*. The handler accepts
  only **local GGUF** models with the `decision` capability; cloud models are
  refused ("System One requires a local Nimble or Tev model") *(code)*. The
  weights must be trained for the prompt format, so an ordinary chat model is
  not a drop-in *(code, handler comment)*.
- Reported latency: ~91 ms per decision, `nimble` 9B on an M5 Max *(press)*.
- Pitched uses: ticket triage, model routing, content moderation *(press)*.
  Nothing about games or control.
- `Ollaya` is a separate open-source "Ollama for Jev-style models" *(press)*.

## Request / response contract *(code)*

```json
{
  "model": "nimble",
  "state": "string | object | array (compacted JSON)",
  "questions": {
    "<name>": { "type": "noul",   "instructions": "...", "criteria": {"false": "...", "true": "..."} },
    "<name>": { "type": "choice", "instructions": "...", "criteria": {"keyA": "description or null", "keyB": null} },
    "<name>": { "type": "score",  "instructions": "...", "criteria": ["level 0 description", "level 1", "level 2"] }
  },
  "keep_alive": "5m"
}
```

- `noul` (yes/no; `criteria` optional) → `{"type":"noul","noul": P(true)}`.
- `choice` → `{"choice": key, "probabilities": {key: p}, "confidence": c}`.
- `score` → `{"score": Σ i·p_i (expected level index), "legend", "probabilities", "confidence"}`.
- Response also carries `model` and `usage.{input_tokens,output_tokens}`.
- Limits: 1–64 questions, 2–26 candidates per question, request body ≤ 64 KiB;
  `state` and `instructions` must be non-empty.

## Mechanism *(code)*

- No text generation. Each question becomes its own prompt:
  `{"context": state, "schema": [all fields]}` + `Requested field: "<name>"`,
  rendered with the model's system prompt and chat template (thinking off).
- Candidates are single-token letter codes `A`..`Z`; the runner **scores** the
  logits of those tokens (`llm.Scorer`), softmax → probabilities.
- `confidence = 1 − entropy / ln(n)`, clamped to [0, 1].
- Cost: one scoring row per question, each re-sending the whole state, so
  latency grows with the number of questions and the state size (a TODO in
  the handler notes that token limits are not checked yet).
