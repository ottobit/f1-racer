# F1 Racer

Mini-campionato 3D nel browser: qualifica, griglia a dieci piloti, garage/assetto, selezione pilota, classifica a punti su più circuiti.

Pubblicato su GitHub Pages: https://ottobit.github.io/f1-racer/

Nessun build step: HTML/CSS/JS serviti così come sono. Three.js è importato da CDN.

## Struttura

```
index.html          selezione circuito/difficoltà/pilota, campionato
race.html            pagina di gara
garage.html           setup/assetto/livrea
*.js / *.css          moduli di gioco (vedi F1-RACER-WIKI.md)
assets/               asset condivisi (stile base, immagine social)
llm-wiki/             memoria di progetto mantenuta con pattern LLM Wiki
```

## Memoria di progetto

`F1-RACER-WIKI.md` è l'handoff tecnico compatto; `llm-wiki/` la memoria estesa (architettura, decisioni, roadmap). `WORK-HANDOFF.md` è il punto di ingresso per una nuova sessione agente. `procedure.md` è il flusso di lavoro obbligatorio (issue → branch → PR → `Concludi`).

## Origine

Estratto da [`ottobit/portfolio-arcade`](https://github.com/ottobit/portfolio-arcade) (dove è nato come uno dei giochi dell'arcade), storia commit preservata.
