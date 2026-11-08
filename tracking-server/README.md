# tracking-server

Vervangt `link.getmailspring.com` voor deze fork: de tracking-pixel, de link-redirect en de
API waar `tracking-sync` de cijfers ophaalt. Geen dependencies, alleen Node ≥ 18.

```bash
node server.cjs                       # http://127.0.0.1:5199
PORT=8080 BIND=0.0.0.0 API_TOKEN=xxx node server.cjs
```

| Endpoint | Wat het doet |
|---|---|
| `GET /o/<token>.png` | 1×1 pixel; `token` = base64url(JSON `{messageId, accountId, recipient}`), precies wat de composer maakt |
| `GET /link/<messageId>/<i>?redirect=<url>&recipient=<base64>` | telt de klik en stuurt 302 naar het originele doel (alleen http/https) |
| `GET /api/tracked` | wat de client pollt; `?accountId=` filtert, `?token=`/`Authorization: Bearer` vereist zodra `API_TOKEN` gezet is |
| `GET /health` | `{ok, tracked, sharedKeys}` |
| `GET /` | minimale HTML-pagina met de tellingen |
| `POST /api/share/thread/<key>` | server de thread-payload (JSON) of `{shared:false}` (verwijdert pagina + attachments); `Authorization: Bearer` vereist zodra `API_TOKEN` of `SHARE_TOKEN` gezet is |
| `POST /api/share/asset/<fileId>/<naam>` | uploadt één attachment (max. 100 MB); zelfde guard als de thread-payload |
| `GET /s/<key>` | webpagina met het gedeelde gesprek |
| `GET /s/a/<fileId>/<naam>` | attachment-download van de gedeelde thread |

Attachments en thread-payloads staan los van de tracking-JSON in `SHARE_DIR`
(standaard `./shared-data`, afzonderlijk mountable). De webpagina draait de message-HTML
in een geïsoleerde sandbox-iframe met een CSP zonder scripts.

Opslag is één JSON-bestand (`DATA_FILE`, standaard `./tracking-data.json`, atomair weggeschreven,
max. 1×/seconde) plus één map attachements/payloads (`SHARE_DIR`). Dat is genoeg voor eigen
gebruik; zet er Postgres achter als je meerdere gebruikers krijgt.

## Twee dingen die je moet weten

- **Gmail/Outlook proxyen afbeeldingen.** Hun image-proxy haalt de pixel op, dus de eerste "open"
  is vaak een bot. De server telt ze wel maar houdt ze apart: `proxyHits` per ontvanger, op basis
  van de user-agent. Vertrouw op `opens - proxyHits` als ondergrens, niet als exactheid.
- **Publieke URL is verplicht.** De pixel-URL wordt in de *verzonden mail* gezet, dus
  `http://127.0.0.1:5199` werkt alleen voor testen naar jezelf. Zet in
  `app/internal_packages/{open,link}-tracking/package.json` → `serverUrl` je publieke HTTPS-host
  (bv. `https://track.example.com`) en hang deze service achter je reverse proxy.
  Hetzelfde geldt voor gedeelde threads: `thread-sharing/package.json` → `serverUrl` regelt de
  share-URLs. De client stuurt geen bearer mee als er geen token staat in `core.sharing.apiToken`
  (of env `NUNCIO_SHARING_TOKEN`). Op de server blokkeer je share-uploads afzonderlijk met
  `SHARE_TOKEN` — volgt geen `SHARE_TOKEN`, dan gelden de `API_TOKEN`-regels zoals bij de
  andere `/api/*`-writes, en kan je de tellings-API open laten terwijl share-uploads wél
  een sleutel vereisen. Zet ook `SHARE_DIR` expliciet als de share-data persistent moet
  overleven (bv. een volume in plaats van de container-root).

## Docker

```bash
docker build -t tracking-server .
docker run -d --name tracking -p 127.0.0.1:5199:5199 -v tracking-data:/data tracking-server
```

`/data/tracking-data.json` is je enige state; back-up = dat bestand.
