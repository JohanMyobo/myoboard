#!/usr/bin/env python3
"""Scores how much of Myoboard's feature checklist is built. Standard library only.

    python3 roadmap/score.py roadmap/features.csv --markdown > roadmap/score.md

Columns of the checklist:

    feature    what it does, in plain words
    area       where it belongs ("editing", "collaboration")
    priority   must | should | could, weighted 3, 2 and 1
    scope      core (part of the checklist) | extra (ours on top, not scored)
    status     yes | partial | no | skip, counted 1, 0.5 and 0; skip is not scored
    notes      details; for skip, why
"""

import argparse
import csv
import sys

WEIGHT = {"must": 3, "should": 2, "could": 1}
CREDIT = {"yes": 1.0, "partial": 0.5, "no": 0.0}


def load(path):
    with open(path, newline="", encoding="utf-8") as fh:
        rows = [{k: (v or "").strip() for k, v in row.items()} for row in csv.DictReader(fh)]
    problems = []
    for line, row in enumerate(rows, start=2):
        if row.get("priority") not in WEIGHT:
            problems.append("line %d: priority %r is not must, should or could" % (line, row.get("priority")))
        if row.get("scope") not in ("core", "extra"):
            problems.append("line %d: scope %r is not core or extra" % (line, row.get("scope")))
        if row.get("status") not in (*CREDIT, "skip"):
            problems.append("line %d: status %r is not yes, partial, no or skip" % (line, row.get("status")))
    if problems:
        raise ValueError("\n".join(problems))
    return rows


def report(rows, markdown):
    scored = [r for r in rows if r["scope"] == "core" and r["status"] != "skip"]
    total = sum(WEIGHT[r["priority"]] for r in scored)
    got = sum(WEIGHT[r["priority"]] * CREDIT[r["status"]] for r in scored)
    musts = [r for r in scored if r["priority"] == "must"]

    areas = {}
    for r in scored:
        done, weight, count = areas.get(r["area"], (0.0, 0, 0))
        areas[r["area"]] = (done + WEIGHT[r["priority"]] * CREDIT[r["status"]], weight + WEIGHT[r["priority"]], count + 1)

    missing = [r for r in scored if r["status"] != "yes"]
    missing.sort(key=lambda r: (-WEIGHT[r["priority"]], CREDIT[r["status"]], r["area"], r["feature"]))

    h = "## " if markdown else ""
    out = [
        "%sFeature checklist: %.1f / 100" % (h, 100.0 * got / total if total else 0.0),
        "",
        "%d features scored, must-haves %d of %d done" % (len(scored), sum(r["status"] == "yes" for r in musts), len(musts)),
        "",
        "%sBy area, least built first" % h,
    ]
    for area, (done, weight, count) in sorted(areas.items(), key=lambda a: a[1][0] / a[1][1]):
        out.append("- %-28s %5.1f  (%d features)" % (area, 100.0 * done / weight, count))
    out += ["", "%sMissing, in build order" % h]
    for r in missing:
        note = "  (%s)" % r["notes"] if r["notes"] else ""
        out.append("- [%s] %s: %s, %s%s" % (r["priority"], r["area"], r["feature"], r["status"], note))
    skipped = [r for r in rows if r["scope"] == "core" and r["status"] == "skip"]
    if skipped:
        out += ["", "%sLeft out on purpose (not scored)" % h]
        out += ["- %s: %s" % (r["feature"], r["notes"]) for r in skipped]
    extras = [r for r in rows if r["scope"] == "extra"]
    if extras:
        out += ["", "%sExtras (not scored)" % h]
        out += ["- %s" % r["feature"] for r in extras]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("checklist", help="the features CSV")
    ap.add_argument("--markdown", action="store_true")
    args = ap.parse_args()
    try:
        print(report(load(args.checklist), args.markdown))
    except (OSError, ValueError) as exc:
        print("score: %s" % exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
