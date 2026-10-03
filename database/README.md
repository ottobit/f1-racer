# Database

Oggi il gioco non usa un database: le stanze multiplayer vivono in memoria nel
server (`core/server/rooms.mjs`) e il resto (campionato, garage, impostazioni)
sta nel `localStorage` del browser.

Questa cartella segue le stesse regole di [`service/`](../service/README.md):
il codice non dipende dal provider.

- Il server parla con il database solo attraverso un modulo d'accesso proprio,
  configurato da variabili d'ambiente (per esempio `DATABASE_URL`). Niente
  nomi di provider nel codice.
- Qui, nel `README`, va il contratto: tipo di database, versione minima,
  variabili richieste, come si creano le tabelle (migrazioni), cosa succede se
  il database non risponde.
- Ogni provider ha la sua sottocartella (`database/<provider>/`) con la sola
  configurazione specifica. Cambiare provider vuol dire aggiungere una
  cartella e cambiare le variabili, non il codice.
