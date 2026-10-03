# F1 Racer

Mini-campionato 3D nel browser: qualifica, griglia a dieci piloti, garage/assetto, selezione pilota, classifica a punti su più circuiti.

Pubblicato su GitHub Pages: https://ottobit.github.io/f1-racer/

Nessun build step: HTML/CSS/JS serviti così come sono. Three.js è importato da CDN.

## Struttura

```
index.html, race.html, garage.html, room.html, modes.html   pagine (servite da GitHub Pages)
core/client/          moduli di gioco JS/CSS (race, garage, multiplayer, home, shared)
core/server/          server delle stanze multiplayer (Node + ws)
core/tools/           script di sviluppo (validazione circuiti)
assets/               asset condivisi (stile base, immagini)
llm-wiki/             memoria di progetto mantenuta con pattern LLM Wiki
```

## Multiplayer: il server delle stanze

Il gioco è statico (GitHub Pages); le stanze multiplayer passano da un piccolo
server WebSocket, `core/server/room-server.mjs`, pubblicato online (oggi su
[Render](https://render.com/)). Dal sito pubblico il gioco lo usa da solo:
basta aprire `room.html`, creare la stanza e mandare il **link di invito**.

Serve `https`/`wss`: la pagina su GitHub Pages è `https://` e il browser blocca
le connessioni a un server `ws://` non cifrato. Il provider dà `https` di suo.

### Mettere online il server

Il server non dipende dal provider: il contratto (porta, avvio, `/health`) e
la configurazione di ogni provider stanno in [`service/`](service/README.md).
Oggi è su Render (`service/render/render.yaml`, piano gratuito): un cron
interno al server chiama il proprio `/health` ogni 10 minuti, così resta
sveglio 24 ore su 24 (circa 744 delle 750 ore gratuite al mese: non c'è
spazio per un secondo servizio gratuito sullo stesso account).

### Server sul tuo computer (sviluppo, o senza server online)

1. Installa [Node.js](https://nodejs.org/), poi da `f1-racer/`:

   ```sh
   npm install
   npm start
   ```

   Deve stampare `listening on :8787`. Una pagina aperta da `localhost` usa
   questo server da sola.
2. Per farlo raggiungere dagli amici esponilo con
   [ngrok](https://ngrok.com/) (`ngrok http 8787`) e apri la stanza con
   `room.html?roomServer=https://abcd-1234.ngrok-free.app`: il link di invito
   porta con sé il server.

### Da sapere

- Le stanze vivono solo in memoria: un riavvio o un nuovo deploy del server le
  cancella.
- Con ngrok gratuito l'indirizzo cambia a ogni avvio: serve un nuovo invito.
- Se la stanza avvisa "il server della stanza è locale", la pagina usa un
  server su `localhost`: togli `?roomServer` per usare quello pubblico.
- Chi perde la connessione ha 30 secondi per rientrare con lo stesso pilota
  (`ROOM_GRACE_MS`); porta configurabile con `PORT`.
- La voce è WebRTC peer-to-peer: su reti molto chiuse può non collegarsi, la
  gara funziona lo stesso.

## Memoria di progetto

`docs/F1-RACER-WIKI.md` è l'handoff tecnico compatto; `llm-wiki/` la memoria estesa (architettura, decisioni, roadmap). `docs/WORK-HANDOFF.md` è il punto di ingresso per una nuova sessione agente. `docs/procedure.md` è il flusso di lavoro obbligatorio (issue → branch → PR → `Concludi`).

## Origine

Estratto da [`ottobit/portfolio-arcade`](https://github.com/ottobit/portfolio-arcade) (dove è nato come uno dei giochi dell'arcade), storia commit preservata.
