# Myoboard

An open-source, self-hostable collaborative whiteboard: sticky notes, shapes,
connectors, sections, a pen, reaction stamps and live cursors, synced in real
time between everyone on the same board.

> Status: MVP in progress (week 1). See `replica/features.csv` for what is
> built so far.

## How it works

- **Document model** (`src/model`): a board is a flat map of objects; each
  object is a map of properties. Concurrent edits merge property by property
  (last writer wins), and a fractional `index` orders objects from back to
  front. Built on [Yjs](https://github.com/yjs/yjs).
- **Sync server** (`server/`): one Node process serves the app and speaks the
  y-websocket protocol on `/ws/<board>`. Boards are saved to `DATA_DIR` as
  Yjs updates.
- **Canvas** (`src/canvas`): React + [Konva](https://konvajs.org).

## License

MIT — see [LICENSE](LICENSE).
