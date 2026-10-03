# Distribuzione del server delle stanze

Il server delle stanze (`core/server/room-server.mjs`) non dipende dal provider
che lo ospita. Qualsiasi servizio che faccia girare Node rispettando questo
contratto va bene. Ogni provider ha la sua sottocartella con i file specifici
(oggi solo `render/`).

## Contratto

| Cosa | Valore |
|---|---|
| Cartella del progetto | `core/` (il server importa anche `core/client/shared/`) |
| Runtime | Node 20 o successivo |
| Installazione | `npm ci --omit=dev` (installa solo `ws`) |
| Avvio | `node server/room-server.mjs` |
| Porta | variabile d'ambiente `PORT` (predefinita 8787) |
| Protocollo | HTTP + WebSocket sulla stessa porta; serve `https`/`wss` (TLS dal provider) |
| Controllo di salute | `GET /health` → `200 ok` |
| Variabili facoltative | `ROOM_GRACE_MS`, `ROOM_QUALI_MS` |
| Stato | solo in memoria: un riavvio cancella le stanze; un'istanza sola |

## Dopo la messa online

1. Metti l'indirizzo pubblico (`wss://…`) in `HOSTED_ROOM_SERVER`,
   `core/client/multiplayer/room-server.js`: il gioco su GitHub Pages lo usa
   da solo.
2. Se il piano si addormenta quando non c'è traffico, crea un monitor esterno
   gratuito (UptimeRobot, cron-job.org) che chiami `https://…/health` ogni
   5-10 minuti. La home e la pagina stanza svegliano comunque il server
   appena si aprono.

## Provider

- `render/render.yaml` — Blueprint di Render: piano gratuito, Francoforte,
  deploy automatico da `master`. Su Render: **New → Blueprint**, indica il
  percorso `deploy/render/render.yaml`. In alternativa crea un **Web Service**
  a mano con i valori della tabella qui sopra.

Per cambiare provider: aggiungi una cartella (`deploy/<provider>/`) con la sua
configurazione, aggiorna `HOSTED_ROOM_SERVER`; il codice del server non cambia.
