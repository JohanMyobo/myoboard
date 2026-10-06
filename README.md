# Myoboard

An open-source, self-hostable collaborative whiteboard: sticky notes, shapes,
connectors, sections, a pen, reaction stamps and live cursors, synced in real
time between everyone on the same board.

![Three people running a sprint retro on Myoboard: notes, a vote and its results, a shared timer, a comment and live cursors](docs/screenshot.png)

## Features

- **Infinite canvas**: scroll or Space-drag to pan, Ctrl/⌘ + scroll (or pinch) to zoom, zoom to fit.
- **Objects**: sticky notes (8 colours, text that shrinks to fit, author name),
  10 shapes with labels (rectangle, pill, ellipse, diamond, triangle,
  hexagon, parallelogram, arrow, star, cylinder), free text, pen strokes,
  images, sections that carry their content when moved, reaction stamps.
- **Connectors**: attached to objects (they meet each shape's real outline),
  straight, elbow or curved, with a label and arrowheads at either end.
- **Images**: add PNG, JPEG, GIF or WebP pictures from the toolbar, by
  dropping files on the board or by pasting a screenshot.
- **Editing**: click, Shift-click or drag a box to select; move, resize,
  recolour, duplicate, bring to front, delete; undo and redo (your own edits
  only); copy, cut and paste within a board, between boards and from other
  apps (a pasted list becomes one sticky note per line).
- **Real time**: everyone on the board sees edits as they happen (text
  included), named cursors, who is here, and what others have selected.
- **Resilient**: every board is saved on the server and kept in the browser
  (IndexedDB), so it opens instantly and keeps working through a dropped
  connection.
- **Accounts and permissions**: sign in with a name and an email out of the
  box, or turn on Google (personal or Workspace accounts), Microsoft or any
  OpenID Connect provider, alone or together. Each board has an owner who invites
  people as editors or viewers and decides what the link gives everyone
  else: nothing, viewing or editing. Viewers see changes live but can
  change nothing, enforced by the server.
- **Your boards**: one page lists the boards you own, were invited to or
  opened, with search and filters, and starts new boards from templates.
- **Workshops**: comments pinned to the board or to a note, with replies
  and resolving; templates (retrospective, brainstorm, kanban, and your
  team's own, saved from any board); a shared timer everyone sees; voting
  sessions with a number of votes per person, results hidden until the end.
- **Sharing and export**: one link per board, editable title, export of the
  whole board or the selection as PNG, JPG or PDF.
- Pans at a median 60 fps with 500 sticky notes, at every zoom level,
  measured in headless Chromium and in Chrome on macOS (see [Tests](#tests)).

## Run it

Requires Git and [Node.js](https://nodejs.org): the LTS version from
nodejs.org is fine (precisely: 22.13 or newer on the 22 line, 24, or 26 and
newer).

```bash
git clone https://github.com/JohanMyobo/myoboard.git
cd myoboard
npm ci
npm start
```

npm 11 may warn that install scripts for `esbuild` and `fsevents` are not
approved: leave them so, nothing needs them (both ship ready-made binaries).

`npm start` builds the app and serves it, with real-time sync, on
<http://localhost:3000>. Without further setup you sign in with a name and an
email, which nobody checks: fine to try it on your machine. Before sharing
the server, turn on a real sign-in such as Google (see Sign-in below).

A first tour, in five minutes:

1. Open <http://localhost:3000>, sign in with any name and email, and pick
   **Retrospective** under *Start from a template*.
2. Add sticky notes (`S`, then click), link two with a connector (`C`,
   drag from one to the other), comment on one (`M`).
3. Open a private window, sign in as someone else and open the same board
   (**Share → Copy link**): each sees the other's cursor and edits live.
   Start a vote or a timer from the top bar.

| Flag           | Variable     | Default   | Purpose                                                   |
| -------------- | ------------ | --------- | --------------------------------------------------------- |
| `--port`       | `PORT`       | `3000`    | HTTP and WebSocket port                                   |
| `--host`       | `HOST`       | `0.0.0.0` | Interface to listen on; `127.0.0.1` keeps it local        |
| `--data-dir`   | `DATA_DIR`   | `./data`  | Where boards, accounts and images are saved               |
| `--public-url` | `PUBLIC_URL` | (none)    | The address people use, e.g. `https://board.example.com`  |

Pass flags after `--`, as in `npm start -- --port 4000`.

For development, `npm run dev` runs Vite with hot reload on
<http://localhost:5173> and the API and sync server on port 1234.

### Run it with Docker

You need Docker: Docker Desktop, or on a Mac the lighter
[Colima](https://github.com/abiosoft/colima)
(`brew install colima docker docker-compose docker-buildx`, add
`"cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"]` to
`~/.docker/config.json` as Homebrew explains, then `colima start`). Then:

```bash
docker compose up -d
```

builds the image and serves Myoboard on <http://localhost:3000>, with its
data in a Docker volume (`/data` in the container). Settings come from the
same `.env` file as below (Sign-in). Put HTTPS in front of it (a reverse proxy such as Caddy, nginx or your company's load
balancer). The image runs as an unprivileged user and reports its health
on `/healthz`.

### Sign-in

Out of the box, people sign in with a name and an email, which nobody
checks: fine on your own machine. Each other way of signing in is an
optional brick you turn on when you need it, and they combine: the sign-in
page shows a button for each one set up. The same email is the same
account, whichever way it signs in.

Settings go in the environment or in a `.env` file next to `package.json`:
copy [`.env.example`](.env.example), which is git-ignored, so secrets never
reach the repository. `npm start` and Docker Compose read it. Restart the
server after changing it.

| Brick | Variables | Notes |
| --- | --- | --- |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, optional `GOOGLE_ALLOWED_DOMAINS` | Personal or work Google accounts; with domains, only accounts managed by those Google Workspace domains |
| Any OpenID Connect provider | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, optional `OIDC_ALLOWED_DOMAINS`, `OIDC_PROVIDER_NAME` | Microsoft Entra ID (`https://login.microsoftonline.com/<tenant id>/v2.0`), Okta, Keycloak… |
| Name and email | `LOCAL_SIGN_IN=on` or `off` | On by default when no provider is set up, off otherwise; `on` keeps it next to a provider |

Every provider sends people back to `<PUBLIC_URL>/auth/callback`: register
that address with it, and set `PUBLIC_URL` to the address people use (for a
first try on your machine, `http://localhost:3000`, and open Myoboard at
exactly that address).

**Google**: in the [Google Cloud console](https://console.cloud.google.com),
create a project and open *Google Auth Platform*. Give the app a name, then
pick its audience:

- *Internal*: only your company's Google Workspace accounts. The project
  must belong to your company's organization (sign in with your work
  account; your Workspace administrator may have to allow it). Set
  `GOOGLE_ALLOWED_DOMAINS` to your domain as well: Myoboard then also
  refuses a personal Google account opened with a company address.
- *External*: any Google account, personal ones included. While the app is
  in *Testing*, only the test users you list can sign in; publish it to
  open it to everyone (sign-in only asks for the name and email, which
  needs no review from Google).

Then *Clients → Create client → Web application*, with the redirect URI
above, and copy the client ID and secret into `.env`.

**Microsoft**: in the Entra admin centre, *App registrations → New
registration*, single tenant, redirect URI of type *Web*; then create a
client secret under *Certificates & secrets*, and fill in the `OIDC_`
variables.

## Keyboard shortcuts

| Key                        | Action                            |
| -------------------------- | --------------------------------- |
| `V` / `H`                  | Select / hand (pan)               |
| `S` / `R` / `T`            | Sticky note / shape / text        |
| `P` / `C` / `F` / `E`      | Pen / connector / section / stamp |
| `M`                        | Comment                           |
| Space + drag               | Pan with any tool                 |
| Enter or double-click      | Edit the selected object's text (a connector's label) |
| Esc                        | Finish editing, clear selection   |
| Delete / Backspace         | Delete the selection              |
| Ctrl/⌘ Z, Ctrl/⌘ Shift Z   | Undo, redo                        |
| `I`                        | Add an image                      |
| Ctrl/⌘ C / X / V           | Copy / cut / paste                |
| Ctrl/⌘ D                   | Duplicate                         |
| Ctrl/⌘ A                   | Select all                        |
| Ctrl/⌘ + / − / 0, Shift 1  | Zoom in / out / 100% / fit        |

## How it works

```text
browser                                        server (one Node process)
┌──────────────────────────────┐   WebSocket   ┌────────────────────────────┐
│ React UI + Konva canvas      │◀─────────────▶│ /ws/<board>: y-websocket   │
│ Board model (Yjs document)   │               │ protocol, presence relay   │
│ IndexedDB copy (y-indexeddb) │               │ boards saved in DATA_DIR   │
└──────────────────────────────┘               └────────────────────────────┘
```

- **Document model** (`src/model`): a board is a flat map of objects, and
  each object is a map of properties. Comments, the timer and votes live
  in the same Yjs document, outside undo. Concurrent edits merge property by
  property (last writer wins), so two people moving and recolouring the same
  sticky never conflict. A fractional `index` orders objects back to front.
  Built on [Yjs](https://github.com/yjs/yjs).
- **Server** (`server/`): one Node process serves the built app, the JSON
  API under `/api`, board images under `/media`, sign-in under `/auth` and
  the y-websocket protocol on `/ws/<board>`. It relays presence (cursors,
  selections) and saves each board as a Yjs update file. Accounts,
  sessions, board owners, invitations and team templates live in a SQLite
  database (`DATA_DIR/myoboard.db`, Node's built-in `node:sqlite`). Board
  ids are restricted to a safe alphabet because they become file names.
- **Permissions**: the server checks your role when the WebSocket opens.
  It never applies edits sent by a viewer, and when an owner changes
  someone's access it disconnects them so they come back with their new
  role.
- **Canvas** (`src/canvas`): [Konva](https://konvajs.org) through
  react-konva. Only objects near the screen are drawn, and text is skipped
  when zoomed out too far to read.
- **UI** (`src/ui`): toolbar, context bar, top bar and zoom controls, with
  [Lucide](https://lucide.dev) icons.

## Tests

```bash
npm run typecheck
npm test            # unit tests + sync server tests with real WebSocket clients
npm run test:e2e    # Playwright: builds the app and drives real browsers
```

The server tests cover accounts, permissions (including a viewer trying
to edit through the sync protocol), images and a complete OpenID Connect
sign-in against a local test provider. The end-to-end suite checks
signing in and the board list, sharing with viewers and editors live,
images (toolbar, drop, paste), copy and paste within and between boards,
shapes and labelled connectors, comments between two people, templates,
the shared timer, voting, exports, two people editing the same board
(edits, drags, cursors, presence),
persistence across reloads and devices, connectors, sections and undo, pen
strokes, shapes, stamps and PNG export, and frame times with 500 sticky
notes. GitHub Actions runs everything on Node 22 and 24 for every push,
and builds and smoke-tests the Docker image.

The end-to-end suite needs a Chromium: run `npx playwright install
chromium` once (about 570 MB in Playwright's cache), or set
`PW_CHANNEL=chrome` or `PW_CHANNEL=msedge` to use the Chrome or Edge you
already have, or point `CHROMIUM_PATH` at any Chromium binary.

## Working on it with Claude Code

[`CLAUDE.md`](CLAUDE.md) gives Claude Code what it needs to work on the
project: setup, commands, architecture, conventions, pitfalls and the
clean-room rules. [`.claude/settings.json`](.claude/settings.json)
pre-approves the install, build, run and test commands, once you accept the
folder-trust prompt the first time you run `claude` in the repository (until
then, Claude Code ignores the project's permissions).

## Clean-room build

Myoboard was written from public information only: published engineering
articles about real-time editing and public product documentation. No
proprietary code, private API, asset, icon, copy or branding was used. The
feature matrix and parity score are in [`replica/`](replica).

## Security

- Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie
  (`Secure` when `PUBLIC_URL` is https), stored hashed. Requests that change
  something, and WebSocket connections, must come from the app's own origin.
- With name-and-email sign-in on, anyone can sign in as anyone: keep it to
  your own machine, and turn it off (`LOCAL_SIGN_IN=off`, the default once
  a provider is set up) on a shared server. The server warns when it
  listens on the network that way.
- An editor can change anything on a board, as on any whiteboard.
- Put the server behind HTTPS (a reverse proxy) when it leaves your laptop.

## Not built yet

Rich text (bold, lists, sizes), files other than images, tables, cursor
chat, following a collaborator, AI. See
[`replica/parity.md`](replica/parity.md) for the full list, in build order.

## License

MIT — see [LICENSE](LICENSE).
