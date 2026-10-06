# Myoboard

Open-source (MIT), self-hostable collaborative whiteboard: sticky notes,
shapes, text, pen, connectors, sections, reaction stamps, live cursors,
real-time sync and PNG export. TypeScript end to end: a React + Konva client
and one Node server that serves the app and syncs boards over WebSockets with
Yjs. No database, account, API key or `.env` file: boards are files in
`data/`.

Status: week-1 MVP, done and tested ("Not built yet" in README.md lists the
gaps). The repository is public: anyone can read everything committed,
history and commit metadata included. Never commit secrets, credentials,
internal hostnames or URLs, other people's names, or personal data, and
don't publish packages or releases unless the user asks.

## Get it running

1. `node --version` must be 22.12+, 24 or 26+ (`.nvmrc` pins 22); the
   dependencies don't support 22.0–22.11, 23 or 25. If it doesn't match,
   stop and ask the user to switch (`nvm use`, `fnm use` or the Node
   installer) rather than working around it.
2. `npm ci`
3. `npm start -- --host 127.0.0.1`, as a background task: it builds, then
   serves the app and sync on http://localhost:3000. Opening `/` creates a
   board at `/b/<id>`.
4. `npm run health` waits until the server answers on `/healthz` (add
   `-- --port <n>` if you changed the port). Use it rather than curl: it is
   pre-approved and behaves the same on every OS.

Stop the servers you start with the background-task tool when you are done.
Use `--host 127.0.0.1` for your own checks: the default, 0.0.0.0, exposes
boards to the network and triggers a firewall prompt on Windows. `data/`
holds the user's real boards (git-ignored): never delete it; point
experiments at a scratch folder with `--data-dir`.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Build, then serve app + sync on :3000 (`npm start -- --port 4000` to change) |
| `npm run dev` | Vite with hot reload on :5173 + sync server on :1234; Vite proxies `/ws` |
| `npm run serve` | Serve the existing `dist/` build without rebuilding |
| `npm run health` | Wait for a server to answer on `/healthz`; exits 1 after 60 s (`--timeout`) |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test` | Vitest: model, geometry, camera, and the sync server with real WebSocket clients |
| `npm run test:e2e` | Playwright: builds, serves on 127.0.0.1:4322 with a fresh `.e2e-data/`, drives Chromium |
| `npm run check` | Typecheck + unit tests |

Server options: `--port` / `PORT` (3000), `--host` / `HOST` (0.0.0.0),
`--data-dir` / `DATA_DIR` (`./data`); a flag wins over its variable. In npm
scripts, put flags after `--`.

One test at a time: `npx vitest run src/model`,
`npx playwright test -g "pen strokes"`.

`.claude/settings.json` pre-approves these commands, in Bash and in
PowerShell (Claude Code's main shell on Windows). A pre-approved command only
matches when run plainly: shell variables (`$?`, `${...}`) or a leading
`NAME=value` make it ask for approval again. Pipes into `tail` or `grep` are
fine.

### Browser for the end-to-end tests

One of:

- `npx playwright install chromium`, once (about 150 MB download);
- `PW_CHANNEL=msedge` or `PW_CHANNEL=chrome` to drive the Edge or Chrome
  already installed, for example when a proxy blocks the download;
- `CHROMIUM_PATH=/path/to/chrome` for any Chromium binary.

Rather than prefixing every run (which also defeats the pre-approval),
suggest the user sets it once in `.claude/settings.local.json` (personal,
git-ignored): `{ "env": { "PW_CHANNEL": "msedge" } }`.

The performance test fails if panning across 500 sticky notes takes a median
of 34 ms or more per frame, zoomed to fit, at 26% or at 100%; headless
Chromium without a GPU and Chrome on macOS both measure about 17 ms.

## Map

```text
src/
  App.tsx            `/` creates a board, `/b/<id>` opens one
  BoardScreen.tsx    board page: state, shortcuts, camera, export, debug handle
  model/             no React: types, Board (Yjs), geometry, palette
  sync/              session (y-websocket + IndexedDB), identity (random name)
  canvas/            Konva: Canvas (tools, drafts, drag, resize), nodes, camera,
                     TextEditor, PeerCursors, exportPng
  ui/                Toolbar, ContextBar, TopBar, ZoomControls, Swatches
  hooks.ts, tools.ts
server/
  index.ts           CLI: options, listen, save every board on exit
  app.ts             HTTP (built app, /healthz) + WebSocket upgrade on /ws/<board>
  rooms.ts           one Room per board: y-websocket protocol, presence, debounced saves
  health.ts          `npm run health`: wait until a server answers
tests/e2e/           Playwright specs and helpers
replica/             feature matrix, parity score, recon notes
```

## Document model

- A board is a Yjs doc. `objects` maps each id to a Y.Map of properties, so
  concurrent edits merge property by property (last writer wins); `meta`
  holds the title.
- Object types (`src/model/types.ts`): sticky, shape (rect, ellipse,
  diamond), text, pen, connector (each end attached to an object or free),
  section, stamp.
- Back-to-front order is a fractional `index` string
  (`fractional-indexing`); ties break on id.
- Change a board only through `Board` methods (`create`, `update`,
  `updateMany`, `remove`, `duplicate`, `transact`...). They tag transactions
  with `LOCAL_ORIGIN`, the origin undo/redo tracks, so undo only reverts your
  own edits; `checkpoint()` closes an undo step. React reads a board through
  `subscribe` and `getSnapshot`.
- `remove` also removes the connectors attached to what it removes.
- Board ids match `/^[A-Za-z0-9_-]{1,64}$/` on the client (`isValidBoardId`)
  and on the server (`isValidRoomName`) because they become file names; keep
  the two in step.

## Gotchas

- Stay on Yjs 13. Don't add `@y/websocket-server`: it pulls a Yjs 14
  pre-release that can't sync with the 13.x client. `server/rooms.ts` speaks
  the protocol with `y-protocols` instead.
- 500 objects pan at 60 fps because: nodes are `memo` components that all
  receive one stable `handlers` object (no inline callbacks or fresh objects
  as props); only objects near the viewport are drawn (`drawRegion`); text and
  shadows are skipped below 25% zoom (`LOW_DETAIL_SCALE`); a sticky note's
  shadow is one pre-blurred bitmap, never Konva's `shadowBlur`, which costs
  about 100 ms a frame with a few hundred notes in Chrome on macOS. PNG export
  sets `fullRender` to draw everything: keep it working if you touch culling.
- Sticky notes, text and stamps are created on pointer release and their
  editor is focused synchronously. Creating them on pointer down loses the
  first typed character.
- The local cursor is tracked on `window`, not on the stage, so it keeps
  moving over overlays.
- A section is dragged by its title tag. Its body ignores pointer events so
  objects inside stay clickable.
- On an open board, `window.__myoboard` exposes `session`, `getCamera`,
  `setCamera` and `getSelection`, for E2E tests and debugging.
- Windows: if PowerShell refuses to run `npm.ps1` (execution policy), call
  `npm.cmd` and `npx.cmd`.
- "Port 3000 is already in use" usually means an earlier server is still
  running: stop it, or pass `--port`.

## Conventions

- TypeScript strict, ES modules, React function components and hooks.
- 2-space indent, no semicolons, single quotes, trailing commas. No formatter
  or linter is set up: match the surrounding code.
- Unit tests sit next to the code (`*.test.ts`); E2E specs in `tests/e2e/`.
- Comments say why, not what, and stay rare.
- Icons come from `lucide-react`; colours and fonts from
  `src/model/palette.ts`.
- Commit messages: an imperative summary line, then a short why.
- Commits are public with their author address. Before the first commit on a
  new machine, check `git config user.email`; if it is not the user's
  GitHub noreply address, suggest that one, set for this repository only.

## Done means

1. `npm run typecheck` and `npm test` pass.
2. `npm run test:e2e` passes when the change touches the canvas, tools, sync
   or server.
3. New behaviour comes with a test: a unit test for model or server logic,
   an E2E test for interactions.
4. A user-facing feature also updates README.md ("Features", "Not built
   yet") and its row in `replica/features.csv`, then re-scores parity:
   `python3 replica/parity.py replica/features.csv --markdown > replica/parity.md`
   (`py` instead of `python3` on Windows).

## Clean-room rules

Myoboard reimplements the core of a commercial whiteboard product from public
information only. Keep it that way:

- Never open, decompile, read the bundles of, or record the network traffic
  of a commercial whiteboard or design tool, and never use one (in a browser
  or through a connector or MCP server) to study how a feature works.
- Public sources only: help-centre articles, published engineering posts,
  public videos.
- Never copy another product's code, icons, illustrations, sounds, wording or
  branding, and don't name other whiteboard products in code, UI, docs or
  commits.
- Dependencies must be MIT, ISC, BSD, Apache-2.0 or CC0: no AGPL, no
  source-available packages, nothing that needs a licence key.

## Security

No sign-in or permissions yet: anyone who has a board's link can edit it.
Don't expose a server beyond a trusted network. WebSocket messages are capped
at 10 MB.

## Next

v2 candidates, in order: sign-in and per-board permissions, comments, images,
copy and paste, templates, elbow connectors with labels (see
`replica/parity.md`). The maintainer sets the scope: check with the user
before starting a large feature.
