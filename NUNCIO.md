# Nuncio — wat deze codebase anders doet dan Mailspring

Nuncio is een afsplitsing van [Foundry376/Mailspring](https://github.com/Foundry376/Mailspring)
(GPL-3.0, versie 1.26.0). Dit bestand is de wijzigingenlijst die GPL §5a vraagt: wat is aangepast
en waarom. De volledige upstream-historie zit in deze repo, dus `git log` blijft de bron van details.

Repo: <https://github.com/Bojanni050/nuncio> · branch `main` · upstream op afstand als
`git remote add upstream https://github.com/Foundry376/Mailspring.git`.

## Uitgangspunt

Upstream zet zijn betaalde features achter een Mailspring-account: de clientcode staat wél in de
GPL-repo, maar de package-loader, de plan-check en de quota's hangen aan `id.getmailspring.com`, en
tracking/vertaling/delen praten met `link.`- en `share.getmailspring.com`. Nuncio haalt die poorten
weg waar de feature puur lokaal is, en vervangt de tracking-backend door een eigen service.

## Wat is aangepast

| Bestand | Wijziging | Waarom |
|---|---|---|
| `app/package.json` | `name`/`productName`/`description` → Nuncio | merknaam is niet in de GPL inbegrepen; `productName` bepaalt ook de profielmap |
| `app/src/browser/application-menu.ts` | menulabel → `Nuncio` | idem |
| `app/internal_packages/open-tracking/package.json` | `isIdentityRequired` weg, `serverUrl` → eigen host | package laadde niet zonder Mailspring-ID; pixel ging naar de leverancier |
| `app/internal_packages/link-tracking/package.json` | idem | link-redirect gaat nu naar eigen host |
| `app/internal_packages/thread-snooze/package.json` | `isIdentityRequired` weg | snooze is puur lokaal |
| `app/internal_packages/send-reminders/package.json` | `isIdentityRequired` weg | idem |
| `app/internal_packages/activity/package.json` | `isIdentityRequired` weg | idem |
| `app/src/flux/stores/identity-store.ts` | `hasProFeatures()` → `true` | er is geen billing-server in deze build |
| `app/src/browser/autoupdate-manager.ts` | `AUTO_UPDATE_DISABLED = true` | anders vervangt de vendor-updater deze build door het officiële binary |
| `app/internal_packages/onboarding/lib/page-authenticate.tsx` | lokale pagina i.p.v. Webview naar `id.getmailspring.com` | die eerste-run-pagina ("Disable Cloud Features?") was HTML van hun server, niet aanpasbaar, en beweerde iets wat hier niet geldt |
| `app/src/compile-cache-ts.js` | cache-write is best-effort | op Windows faalde de atomaire rename (EPERM) en nam de module-load mee |
| `app/internal_packages/tracking-sync/` (nieuw) | poller die tellingen in `open_data`/`click_data` schrijft | de *writer* van die metadata zat op hun server |
| `tracking-server/` (nieuw) | pixel, link-redirect, `/api/tracked`, Dockerfile | vervangt `link.getmailspring.com` |
| `scripts/fetch-mailsync.js` (nieuw) | haalt de engine op uit deze fork's release (of `MAILSPRING_MAILSYNC_URL`) | biedt een expliciete route naar de fork-binary; upstreams binary is onbruikbaar |
| `scripts/postinstall.js` | downloadt geen upstream-mailsync meer; meldt hoe je de fork-engine ophaalt/bouwt | upstreams binary heeft de Nuncio-blokkerende padcheck |
| `.gitmodules` + gitlink | submodule → `Bojanni050/Mailspring-Sync`, branch `lyng-1.26` | de engine moet zonder de branding-gate gebouwd worden |
| `mailsync/MailSync/main.cpp` (in de engine-fork) | `#ifndef DEBUG`-blok met de `"mailspring"`-padcheck verwijderd | die check laat elke hernoemde build met exit 2 sterven, wat de client alleen als "an unknown error has occurred mailsync: 2" kan tonen |

Bewust **niet** aangeraakt: `mailspring-exports`, `mailspring://`-protocol en de interne
package-namen. Die zijn dragend; een volledige rename sloopt de build zonder winst.

## De sync-engine (mailsync)

De client start per account een C++-proces; zonder dat proces start de app niet. Upstream bouwt dat
en publiceert de binary's, maar die bevatten een check die het proces weigert te starten als het pad
naar de executable niet de tekst `mailspring` bevat (`main.cpp`, `return 2`). Daarom bouwt Nuncio de
engine zelf uit een eigen submodule-fork:

- Bron: <https://github.com/Bojanni050/Mailspring-Sync>, branch `lyng-1.26` (GPL-3.0, gate eruit).
- Kant-en-klaar: release [`engine-e35e421`](https://github.com/Bojanni050/Mailspring-Sync/releases/tag/engine-e35e421)
  met `mailsync-win-ia32.tar.gz` (76 bestanden: `mailsync.exe`, `.pdb`, DLL's).
- Ophalen: `npm run fetch-mailsync` — probeert eerst `MAILSPRING_MAILSYNC_URL`, dan het
  release-artifact van jouw platform, en stopt met een duidelijke melding als er geen artifact is
  (upstream's prebuilt wordt bewust **niet** meer als fallback gebruikt: verkeerde bron én de gate).
- Zelf bouwen: de Windows-workflow in de engine-fork (`Actions → Build Windows → Run workflow`) of
  lokaal met Visual Studio 2022 + vcpkg en `msbuild Windows\mailsync.sln /p:Configuration=Release;Platform=Win32`.
  Voor Linux/macOS bestaat er nog géén artifact; die workflow (`build.yml`) moet dan eerst draaien.

## Wat werkt, en wat niet

**Zonder verdere backend:** snooze, send later, send reminders, activity, undo send,
translation (BYOK: AI-model/DeepL/LibreTranslate, eigen key), en alle
mail-functionaliteit (IMAP/SMTP, regels, sjablonen, zoeken).

**Met `tracking-server/`:** open tracking (pixel + teller), link tracking (redirect + teller), de
"Opened by"/"Clicked by"-popovers die `open_data`/`click_data` lezen, en thread-sharing (gedeelde
threads + attachments als publieke webpagina op `/s/<key>`; accesstoken via `core.sharing.apiToken`
of `NUNCIO_SHARING_TOKEN`).

**Bewust uit** (pakket houdt `isIdentityRequired`, dus het laadt niet): `participant-profile`
(contactverrijking). Die vragen een vendor-endpoint op `id.getmailspring.com` en kunnen niet
zonder server-component.

## Draaien

```bash
npm install                       # Node 22 (node-llama-cpp gebruikt JSON-import-attributes)
npm run fetch-mailsync            # haalt de fork-engine op als die nog ontbreekt
npm start                         # electron ./app --dev
```

Ontbreekt de sync-engine ("could not find the mailsync process"), dan:

```bash
npm run fetch-mailsync
```

Map van de dev-data: `%APPDATA%\Nuncio-dev` (macOS: `~/Library/Application Support/Nuncio-dev`,
Linux: `~/.config/Nuncio-dev`).

## Licentie

GPL-3.0, zie `LICENSE.md`. Verspreid je binaries, dan moet de volledige bron mee — inclusief
`tracking-server/`. De naam en het logo van Mailspring zijn niet in de GPL inbegrepen en worden hier
niet gebruikt; omgekeerd is Nuncio niet gelieerd aan of goedgekeurd door het Mailspring-project.
