# Recon

**Reference product:** a collaborative online whiteboard (sticky notes,
shapes, connectors, sections, stamps, live cursors).

**Slice rebuilt:** the core loop of a workshop board: put ideas on sticky
notes, group them in sections, link them, react to them, together and live.

**Who it is for:** teams that want a self-hosted, open-source board they
control.

## Sources

Public material only. No account of the reference product was used to study
it, and none of its code, bundles, network traffic, assets, icons or copy.

- Public product documentation (feature lists, keyboard conventions common
  to whiteboard tools).
- Published engineering articles on real-time editing: a server-authoritative,
  property-level last-writer-wins model, fractional indexes for ordering, and
  WebSockets with one process per document.

## Out of scope

- The reference product's plugin and widget ecosystem: a developer
  marketplace, not part of the product to rebuild.
- Its brand, visual identity and wording: Myoboard has its own.

## Feature matrix

[`features.csv`](features.csv), scored in [`parity.md`](parity.md) by
[`parity.py`](parity.py), vendored from the
[Replica](https://github.com/Jakeschincariol/replica-skill) skills (MIT).
Python 3, standard library only:

```bash
python3 replica/parity.py replica/features.csv --markdown > replica/parity.md
```
