# Myoboard

An open-source, self-hostable collaborative whiteboard: sticky notes, shapes,
connectors, sections, a pen, reaction stamps and live cursors, synced in real
time between everyone on the same board.

![Two people running a sprint retro on Myoboard](docs/screenshot.png)

## Features

- **Infinite canvas**: scroll or Space-drag to pan, Ctrl/⌘ + scroll (or pinch) to zoom, zoom to fit.
- **Objects**: sticky notes (8 colours, text that shrinks to fit, author name),
  shapes (rectangle, ellipse, diamond) with labels, free text, pen strokes,
  connectors attached to objects, sections that carry their content when
  moved, reaction stamps.
- **Editing**: click, Shift-click or drag a box to select; move, resize,
  recolour, duplicate, bring to front, delete; undo and redo (your own edits only).
- **Real time**: everyone on the board sees edits as they happen (text
  included), named cursors, who is here, and what others have selected.
- **Resilient**: every board is saved on the server and kept in the browser
  (IndexedDB), so it opens instantly and keeps working through a dropped
  connection.
- **Sharing and export**: one link per board, editable title, PNG export of
  the whole board.
- Pans at a median 60 fps with 500 sticky notes, measured in headless
  Chromium without a GPU (see [Tests](#tests)).

## Run it

Requires Node.js 22 or newer.

```bash
npm install
npm start
```

`npm start` builds the app and serves it, with real-time sync, on
<http://localhost:3000>. Opening it creates a new board; share its address
with anyone who can reach the machine.

| Variable   | Default   | Purpose                                |
| ---------- | --------- | -------------------------------------- |
| `PORT`     | `3000`    | HTTP and WebSocket port                |
| `HOST`     | `0.0.0.0` | Interface to listen on                 |
| `DATA_DIR` | `./data`  | Where boards are saved (one file each) |

For development, `npm run dev` runs Vite with hot reload on
<http://localhost:5173> and the sync server on port 1234.

> **No sign-in yet.** Anyone who has a board's link can edit it. Run Myoboard
> on a trusted network or behind your own authentication (reverse proxy, SSO)
> until accounts and permissions land.

## Keyboard shortcuts

| Key                        | Action                            |
| -------------------------- | --------------------------------- |
| `V` / `H`                  | Select / hand (pan)               |
| `S` / `R` / `T`            | Sticky note / shape / text        |
| `P` / `C` / `F` / `E`      | Pen / connector / section / stamp |
| Space + drag               | Pan with any tool                 |
| Enter or double-click      | Edit the selected object's text   |
| Esc                        | Finish editing, clear selection   |
| Delete / Backspace         | Delete the selection              |
| Ctrl/⌘ Z, Ctrl/⌘ Shift Z   | Undo, redo                        |
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
  each object is a map of properties. Concurrent edits merge property by
  property (last writer wins), so two people moving and recolouring the same
  sticky never conflict. A fractional `index` orders objects back to front.
  Built on [Yjs](https://github.com/yjs/yjs).
- **Sync server** (`server/`): serves the built app, speaks the y-websocket
  protocol on `/ws/<board>`, relays presence (cursors, selections) and saves
  each board as a Yjs update file. Board ids are restricted to a safe
  alphabet because they become file names.
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

The end-to-end suite checks two people editing the same board live (edits,
drags, cursors, presence), persistence across reloads and devices,
connectors, sections and undo, pen strokes, shapes, stamps and PNG export,
and frame times with 500 sticky notes. It needs a Chromium: run
`npx playwright install chromium` once, or point `CHROMIUM_PATH` at an
existing one.

## Clean-room build

Myoboard was written from public information only: published engineering
articles about real-time editing and public product documentation. No
proprietary code, private API, asset, icon, copy or branding was used. The
feature matrix and parity score are in [`replica/`](replica).

## Not built yet

Sign-in and permissions, comments, images, templates, voting, timer, rich
text, copy and paste, elbow connectors with labels. See
[`replica/parity.md`](replica/parity.md) for the full list, in build order.

## License

MIT — see [LICENSE](LICENSE).
