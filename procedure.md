# Development Procedure

Procedura operativa obbligatoria per ogni modifica al repository.

## Classificazione

Ogni issue deve avere almeno una label che descriva il tipo di lavoro:

- `bug` — correzione di un comportamento errato o regressione.
- `documentation` — documentazione, inclusa la wiki tecnica.
- `enhancement` — nuova funzionalita, miglioramento o comportamento aggiunto.

Se un task ricade in piu categorie, possono essere applicate piu label.

## Flusso obbligatorio

1. **Issue** — creare o identificare una issue e applicare la label corretta.
2. **Branch** — creare un branch dedicato partendo da `master` aggiornato.
3. **Sviluppo** — implementare esclusivamente sul branch.
4. **Check strutturale** — eseguire solo controlli rapidi di struttura/sorgente pertinenti prima del commit/PR, per esempio `git diff --check`, parsing statico o import mirati quando sono economici. Smoke test browser, test runtime, gameplay e release test automatici non sono obbligatori di default.
5. **Commit / Push** — commit sul branch dedicato. **Mai commit o push diretti su `master`.**
6. **Pull Request** — aprire una PR verso `master`, collegata alla issue e con descrizione di modifica e check eseguiti.
7. **Note di verifica** — nella PR dichiarare i check strutturali eseguiti e cio che resta a verifica manuale dell'utente. La giocabilita viene validata dall'utente giocando, salvo richiesta esplicita di test aggiuntivi.
8. **Approvazione utente** — per default, dopo sviluppo e check strutturale, lasciare la PR aperta. Il merge avviene solo quando l'utente approva esplicitamente dicendo **`Concludi`**.
9. **Merge** — dopo `Concludi`, effettuare il merge della PR. Il commit risultante su `master` deve provenire dalla PR.
10. **Ordine di conclusione PR** — se ci sono piu PR aperte da concludere, effettuare merge/chiusura in **ordine numerico crescente**. Deviare dall'ordine solo in presenza di una dipendenza tecnica esplicita, da dichiarare prima del merge.
11. **Prossima issue** — solo dopo la conclusione della precedente si passa al task successivo.

### Modalita auto-conclusione

Se **prima dello sviluppo** utente e assistente concordano esplicitamente un piano e stabiliscono che quel piano e in **modalita auto-conclusione**, non e necessario attendere `Concludi` per ogni PR prevista dal piano. In quel caso, completati sviluppo e check strutturale, la PR puo essere mergiata automaticamente secondo il piano concordato.

In assenza di un accordo preventivo esplicito sulla modalita auto-conclusione, vale sempre la regola standard: **PR aperta fino a `Concludi`**.

## Regole di check strutturale

- Di default non eseguire smoke test browser, runtime gameplay o release test automatici.
- Preferire check economici e mirati ai file modificati.
- Evitare log voluminosi, screenshot, download e polling completi dei workflow se non sono necessari.
- Se una verifica richiede molti token o tempo, dichiararla come verifica manuale dell'utente invece di eseguirla automaticamente.
- Se il repository non dispone dell'ambiente necessario per un check strutturale, indicare esplicitamente il limite nella PR.

## F1 Racer

Mantenere aggiornati quando necessario:

- `F1-RACER-WIKI.md` per architettura e comportamento.
- `RELEASE-CHECKLIST.md` per nuovi casi di regressione e release gate.
- `llm-wiki/wiki/f1-racer/` per decisioni durevoli, roadmap e memoria di progetto
  che non deve perdersi tra chat, issue e PR.

## LLM Wiki

Il repository usa `llm-wiki/` come memoria markdown mantenuta dagli agenti,
ispirata al pattern LLM Wiki di Karpathy.

Quando una modifica introduce una decisione architetturale, un vincolo utente,
una fonte esterna rilevante o un apprendimento riutilizzabile:

1. leggere `llm-wiki/AGENTS.md`;
2. aggiornare la pagina wiki piu specifica;
3. aggiungere una fonte in `llm-wiki/sources/` solo se serve;
4. appendere una nota breve in `llm-wiki/logs/maintenance.md`.