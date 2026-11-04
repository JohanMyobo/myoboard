# Roadmap

**What Myoboard is:** an open-source, self-hosted board for workshops: put
ideas on sticky notes, group them in zones, link them, react to them and
decide together, live.

**Who it is for:** teams that want a board they host and control, with
facilitation (timer, votes, templates) built in.

## How it is built

From public material only: general knowledge of whiteboard conventions
(keyboard shortcuts, sticky notes, connectors) and published engineering
articles on real-time editing (property-level last-writer-wins, fractional
indexes for ordering, WebSockets with one process per document). No other
product's code, bundles, network traffic, assets, icons or wording.

The look is Myoboard's own, in the Myobo brand: navy and sky blues, Lustria
titles, sticky notes with a folded corner, zones tagged in navy, a squared
canvas.

## Feature checklist

[`features.csv`](features.csv) lists what a workshop board needs and what is
built, scored in [`score.md`](score.md) by [`score.py`](score.py) (Python 3,
standard library only):

```bash
python3 roadmap/score.py roadmap/features.csv --markdown > roadmap/score.md
```
