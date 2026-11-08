# Nuncio

A local-first mail client for macOS, Windows and Linux, built on the Mailspring codebase.

**Credits and licence.** Nuncio is a fork of [Mailspring](https://github.com/Foundry376/Mailspring)
by Foundry376 and its contributors, and stays under **GPL-3.0** (see `LICENSE.md`). The changes this
fork makes are listed in [`NUNCIO.md`](NUNCIO.md) — that list is the "state your changes" part of
GPL §5a. The name and logo are Nuncio's own; nothing here is endorsed by or affiliated with the
Mailspring project.

Functionally this build does two things differently: the pro features that only needed client code
(snooze, send later, reminders, activity, open/link tracking) run without a Mailspring ID, and
tracking talks to a self-hosted server instead of the vendor's. Translation, contact enrichment and
thread sharing are switched off — they need a server this fork does not ship.

The original project README follows, still accurate for everything not listed in `NUNCIO.md`.

---

## Features

- Local-first IMAP/SMTP sync engine that runs on your machine — mail credentials stay in your system keychain.
- Unified Inbox, Snooze, Send Later, Mail Rules, Templates and more, all running in the client.
- Self-hosted open/link tracking: activity data goes to a server **you** control, not to a vendor.

For details on what this fork changes, see [`NUNCIO.md`](NUNCIO.md).

## Download

Build from source (below), or grab a package from the
[release page](https://github.com/Bojanni050/nuncio/releases).

## Running Nuncio from Source

To install all dependencies and run Nuncio from its source code,
run the following commands from the root directory of the repository:

```
export npm_config_arch=x64 # If you are on an M1 / Apple Silicon Mac
npm install
npm start
```

You can attach command line parameters by separating them using a double hyphen:

```
npm start -- --help
```

## Building Nuncio

To build Nuncio, you need to run the following command from the root directory
of the repository:

```
npm run-script build
```

## Building a Plugin or Theme

Plugins lie at the heart of Nuncio and give it its powerful features.
Building your own plugins allows you to integrate the app with other tools,
experiment with new workflows, and more. Follow the [Getting Started
guide](https://Bojanni050.github.io/nuncio/) to write your first plugin in
five minutes.

- To create your own theme, check out the
  [Mailspring-Theme-Starter](https://github.com/Foundry376/Mailspring-Theme-Starter)
  (Mailspring templates work as Nuncio themes).

- To create your own plugin, check out the
  [Mailspring-Plugin-Starter](https://github.com/Foundry376/Mailspring-Plugin-Starter)
  (the plugin API is shared).

A plugin "store" like the Chrome Web Store is not planned; users need to
"sideload" plugins into the app by downloading them and copying them into
place. Share plugins and questions through
[GitHub issues and discussions](https://github.com/Bojanni050/nuncio).

For SDK documentation, see [`app/build/docs_src/`](app/build/docs_src/SUMMARY.md).

## Contributing to Nuncio Core

Pull requests are always welcome — check out
[CONTRIBUTING](CONTRIBUTING.md) for more information about setting up the
development environment, running tests locally, and submitting pull requests.

[![Contributor Covenant](https://img.shields.io/badge/Contributor%20Covenant-v2.0%20adopted-ff69b4.svg)](CODE_OF_CONDUCT.md)

## Localizing / Translating

Nuncio supports localization. If you're a fluent speaker of another language,
we'd love your help improving translations — see the
[LOCALIZATION](LOCALIZATION.md) guide.

## Credits and Licence

Nuncio is a fork of [Mailspring](https://github.com/Foundry376/Mailspring) by
Foundry376 and its contributors: the UI is open source (GPL-3.0) and written
in TypeScript with [Electron](https://github.com/atom/electron) and
[React](https://facebook.github.io/react/); the sync engine is open source
(GPL-3.0) C++ from the [Mailspring-Sync](https://github.com/Bojanni050/Mailspring-Sync)
lineage, based on [Mailcore2](https://github.com/MailCore/mailcore2).
Nuncio itself is also released under **GPL-3.0** (see `LICENSE.md`), and is not
endorsed by or affiliated with the Mailspring project.
