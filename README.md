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

## Multiplayer: avviare il server delle stanze

Il gioco è statico e non ha un server sempre acceso. Per correre con gli amici
(fino a 10, solo piloti umani, con chat vocale) una persona, l'**host**, fa
girare sul proprio computer il server delle stanze e lo espone su internet con
[ngrok](https://ngrok.com/). Gli altri giocatori non installano niente: aprono
il link di invito.

Serve `https`/`wss` anche se siete tutti in casa: la pagina su GitHub Pages è
`https://` e il browser blocca le connessioni a un server `ws://` non cifrato.

### Una volta sola

1. Installa [Node.js](https://nodejs.org/) e [ngrok](https://ngrok.com/download)
   (account gratuito; collega il token come indicato da ngrok).
2. Clona e installa:

   ```sh
   git clone https://github.com/ottobit/f1-racer.git
   cd f1-racer
   npm install
   ```

   Il `package.json` della cartella principale installa anche le dipendenze di
   `core/`: tutti i comandi si lanciano da `f1-racer/`.

### Ogni sessione di gioco

1. Avvia il server (da `f1-racer/`) e lascia il terminale aperto:

   ```sh
   npm run start:room-server
   ```

   Deve stampare `listening on ws://localhost:8787`.
2. In un secondo terminale apri il tunnel e copia l'indirizzo `https://…`:

   ```sh
   ngrok http 8787
   ```

3. Apri la stanza passando quell'indirizzo:

   ```
   https://ottobit.github.io/f1-racer/room.html?roomServer=https://abcd-1234.ngrok-free.app
   ```

4. Crea la stanza e manda agli amici il **link di invito**: contiene già codice
   stanza e server. Da lì il flusso è spiegato nel "?" della pagina stanza.

### Da sapere

- Il PC dell'host resta acceso con entrambi i terminali aperti; se il server si
  ferma, le stanze spariscono (stato solo in memoria).
- Con ngrok gratuito l'indirizzo cambia a ogni avvio: serve un nuovo invito.
- Se la stanza avvisa "il server della stanza è locale", manca `?roomServer=…`.
- Chi perde la connessione ha 30 secondi per rientrare con lo stesso pilota
  (`ROOM_GRACE_MS`); porta configurabile con `PORT`.
- La voce è WebRTC peer-to-peer: su reti molto chiuse può non collegarsi, la
  gara funziona lo stesso.

## Memoria di progetto

`F1-RACER-WIKI.md` è l'handoff tecnico compatto; `llm-wiki/` la memoria estesa (architettura, decisioni, roadmap). `WORK-HANDOFF.md` è il punto di ingresso per una nuova sessione agente. `procedure.md` è il flusso di lavoro obbligatorio (issue → branch → PR → `Concludi`).

## Origine

Estratto da [`ottobit/portfolio-arcade`](https://github.com/ottobit/portfolio-arcade) (dove è nato come uno dei giochi dell'arcade), storia commit preservata.
