# GameSlop

Estensione cross-browser (Chrome + Firefox, Manifest V3) che blocca giochi Roblox flaggati come generati da AI e permette agli utenti di segnalarli a un webhook admin.

## Funzionalità

- Pulsante "Segnala come AI" sulla pagina dettaglio gioco (`/games/{id}`)
- Menu 3 puntini su ogni card in home/categorie/profili per segnalare o sbloccare
- Giochi bloccati: play disabilitato, card oscurata, link neutralizzato
- Sblocco temporaneo (solo sessione) o definitivo dal menu o dal popup
- Popup con stats, lista bloccati, ricerca, toggle on/off
- Webhook configurabile dal popup (salvato offuscato con salt random per utente)
- Sync opzionale di una blocklist remota (JSON con `{ "games": [{ "id", "name" }] }`)
- Rate limit (max 5 report / minuto, min 3s tra un report e l'altro)
- Dedup 6 ore per stesso `gameId`
- Firma pseudo-HMAC (SHA-256 con secret interno) sul payload per filtrare richieste non provenienti dall'estensione lato webhook/bot admin

## Installazione

### Chrome / Edge / Brave
1. Vai su `chrome://extensions`
2. Attiva "Modalità sviluppatore"
3. "Carica estensione non pacchettizzata" → seleziona la cartella `gameslop/`

### Firefox
1. Vai su `about:debugging#/runtime/this-firefox`
2. "Carica componente aggiuntivo temporaneo..." → seleziona `gameslop/manifest.json`

## Configurazione webhook (admin)

Apri il popup dell'estensione e incolla l'URL webhook Discord (o qualunque endpoint HTTPS che riceva POST JSON) nel campo "Webhook segnalazioni". Il payload viene inviato in formato Discord-compatibile + oggetto `gs_payload` strutturato:

```json
{
  "type": "ai_game_report",
  "game_id": "123",
  "game_name": "...",
  "game_url": "https://www.roblox.com/games/123",
  "reason": "thumbnail AI...",
  "reporter_hash": "abc123...",
  "ext_version": "1.0.0",
  "ts": 1713900000000,
  "sig": "..."
}
```

L'header `X-GS-Sig` replica la firma. Il bot admin accetta/rifiuta la segnalazione e può distribuire la blocklist aggregata via l'endpoint di sync remoto configurabile nel popup.

## Note sicurezza

- Nessun webhook in chiaro nel codice: le parti offuscate sono rumore XOR-random (senza chiave utente non decodificano URL validi)
- Il webhook reale viene salvato lato client offuscato con XOR+salt utente di 16 byte random
- Firma HMAC-like sui report (non previene spoofing totale, ma basta per filtrare noise da scrape del webhook)
- Nessuna credenziale Roblox letta/toccata, nessun cookie inviato (fetch `credentials: "omit"`)
