# Servizio: il server delle stanze

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
| Variabili facoltative | `ROOM_GRACE_MS`, `ROOM_QUALI_MS`, `KEEP_AWAKE_*` (sotto) |
| Stato | solo in memoria: un riavvio cancella le stanze; un'istanza sola |

## Dopo la messa online

1. Metti l'indirizzo pubblico (`wss://…`) in `HOSTED_ROOM_SERVER`,
   `core/client/multiplayer/room-server.js`: il gioco su GitHub Pages lo usa
   da solo.
2. Se il piano addormenta il servizio quando non c'è traffico, attiva il
   risveglio interno dalla configurazione del provider:

   | Variabile | Significato |
   |---|---|
   | `KEEP_AWAKE_URL` | indirizzo pubblico `https://…`; senza, il risveglio è spento |
   | `KEEP_AWAKE_WINDOW` | fascia oraria `HH:MM-HH:MM`, può passare la mezzanotte (predefinita: tutto il giorno) |
   | `KEEP_AWAKE_TZ` | fuso orario della fascia (predefinito `UTC`) |

   Nella fascia il server chiama il proprio `/health` ogni 10 minuti; fuori
   fascia smette e il provider può addormentarlo. Un servizio addormentato non
   si sveglia da solo all'inizio della fascia: lo sveglia il primo visitatore
   (home e pagina stanza chiamano `/health` appena si aprono), oppure una
   singola chiamata esterna programmata a quell'ora (per esempio
   cron-job.org).

## Provider

- `render/render.yaml` — Blueprint di Render: piano gratuito, Francoforte,
  deploy automatico da `master`, sveglio dalle 9:00 alle 3:00 (ora italiana). Su Render: **New → Blueprint**, indica il
  percorso `service/render/render.yaml`. In alternativa crea un **Web Service**
  a mano con i valori della tabella qui sopra.

Per cambiare provider: aggiungi una cartella (`service/<provider>/`) con la sua
configurazione, aggiorna `HOSTED_ROOM_SERVER`; il codice del server non cambia.
