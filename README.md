# swen

Terminal UI for browsing the main Italian news outlets via RSS.

## Install

```sh
npm install
```

## Run

```sh
npm run dev                  # tsx — no build needed
npm run dev -- --limit 20
npm run dev -- --feeds ./my-feeds.json

npm run build && npm start
```

## Feeds

Feeds are configured in `feeds.json` at the project root. Each entry:

```json
{ "name": "ANSA", "url": "https://...", "category": "general" }
```

Override the path with `--feeds <path>`.

## Keys

- `↑`/`↓` or `k`/`j` — move cursor
- `Enter` or `l`/`→` — open detail
- `Esc` or `h`/`←` — back to list
- `o` — open the article URL in your default browser
- `r` — refresh
- `q` or `Ctrl+C` — quit
