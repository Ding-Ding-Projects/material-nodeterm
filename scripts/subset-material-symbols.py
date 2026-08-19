#!/usr/bin/env python3
"""Subset Material Symbols Rounded (variable) to the app's exact glyph set.

Regenerates `src/renderer/assets/fonts/material-symbols/material-symbols-rounded-subset.woff2`
from the `material-symbols` npm package (see scripts/material-symbols-glyphs.json for the pinned
glyph list, and THIRD-PARTY-NOTICES.md for licensing). This is a build-time tool only -- it runs
against packages already installed under node_modules and never fetches anything from the network.

Subsets BY CODEPOINT, not by ligature/text. Subsetting by ligature requires keeping every Latin
letter used across all icon names, and fontTools' GSUB closure then pulls in every OTHER ligature
reachable from that same letter set -- i.e. most of the font. Codepoint subsetting keeps only the
requested icons' PUA glyphs plus fontTools' own required boilerplate (.notdef, .null,
nonmarkingreturn), and is what the shipped MaterialSymbol component actually renders (a single
private-use character, resolved via the generated codepoint map -- see
src/renderer/components/materialSymbols.generated.ts).

Requires: pip install "fonttools[woff]==4.55.3" (pinned; installed for this build but not
otherwise recorded anywhere Node tooling reads -- there is no requirements.txt in this repo).

Usage: py -3 scripts/subset-material-symbols.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_FONT = REPO_ROOT / "node_modules" / "material-symbols" / "material-symbols-rounded.woff2"
GLYPH_LIST = REPO_ROOT / "scripts" / "material-symbols-glyphs.json"
OUTPUT_FONT = (
    REPO_ROOT
    / "src"
    / "renderer"
    / "assets"
    / "fonts"
    / "material-symbols"
    / "material-symbols-rounded-subset.woff2"
)
MANIFEST_OUT = REPO_ROOT / "scripts" / "material-symbols-codepoints.generated.json"

# Requested names that do not exist as a glyph (under any name, checked across every cmap
# subtable AND the raw glyph order / post table, and cross-checked against the authoritative
# `type MaterialSymbols = [...]` union in node_modules/material-symbols/index.d.ts) in
# material-symbols@0.46.0's Rounded font. Neither name, nor any near-miss (phone_iphone,
# phone_android, stay_current_portrait for the first one), exists in this exact package
# version. Both substitutions below are explicit product decisions (not this script's
# guesses), confirmed 2026-08-18:
#   - "smartphone" -> "mobile": this glyph labels a phone-pairing action (exactly one mobile
#     phone), so "mobile" is the direct semantic match; "devices" (an assortment of device
#     types) was considered and rejected as misleading for that specific use.
#   - "system_update" -> "system_update_alt": same concept, exists verbatim minus the suffix.
#     Plain "update" also exists but reads as a generic refresh rather than "update the
#     installed app", so the "_alt" sibling is the better fit.
# Flagged loudly (never silently) wherever applied -- see the WARNING print below.
KNOWN_MISSING_ALIASES: dict[str, str] = {
    "smartphone": "mobile",
    "system_update": "system_update_alt",
}


def resolve_codepoints(font: TTFont, names: list[str]) -> dict[str, int]:
    """Map each requested icon name to its PUA codepoint via the font's OWN cmap.

    The Material Symbols variable fonts ship BOTH a ligature (GSUB) path and a direct PUA
    cmap entry per icon, and the font's own glyph names ARE the icon names -- so codepoint
    resolution never needs an external `.codepoints` file (this exact npm package does not
    ship one; verified by searching node_modules/material-symbols for any codepoints-shaped
    file -- none exists). We resolve by finding the codepoint(s) whose cmap value equals the
    requested glyph name.
    """
    name_to_codepoints: dict[str, list[int]] = {}
    for table in font["cmap"].tables:
        for codepoint, glyph_name in table.cmap.items():
            name_to_codepoints.setdefault(glyph_name, []).append(codepoint)

    glyph_order = set(font.getGlyphOrder())
    resolved: dict[str, int] = {}
    unresolved: list[str] = []
    substituted: dict[str, str] = {}

    for requested in names:
        lookup_name = requested
        if requested not in name_to_codepoints and requested not in glyph_order:
            if requested in KNOWN_MISSING_ALIASES:
                lookup_name = KNOWN_MISSING_ALIASES[requested]
                substituted[requested] = lookup_name
                print(
                    f"WARNING: glyph '{requested}' does not exist in material-symbols "
                    f"Rounded -- substituting nearest available icon '{lookup_name}'. "
                    "This is loud on purpose (see KNOWN_MISSING_ALIASES in this script).",
                    file=sys.stderr,
                )
            else:
                unresolved.append(requested)
                continue

        codepoints = sorted(name_to_codepoints.get(lookup_name, []))
        if not codepoints:
            unresolved.append(requested)
            continue
        # Multiple codepoints commonly alias one glyph (legacy + current PUA slot). Any of
        # them renders the identical glyph; take the lowest for a stable, reproducible build.
        resolved[requested] = codepoints[0]

    if unresolved:
        raise SystemExit(
            "FATAL: the following requested Material Symbols glyph name(s) do not exist in "
            f"material-symbols@0.46.0 Rounded and have no configured alias: {unresolved}. "
            "Add a real replacement name to scripts/material-symbols-glyphs.json, or register "
            "an alias in KNOWN_MISSING_ALIASES above. Refusing to ship a font silently missing "
            "requested icons."
        )

    if substituted:
        print(f"Applied {len(substituted)} loud substitution(s): {substituted}", file=sys.stderr)

    return resolved


def main() -> None:
    if not SOURCE_FONT.exists():
        raise SystemExit(
            f"FATAL: {SOURCE_FONT} not found. Run `npm install` first "
            "(material-symbols is a devDependency; see package.json)."
        )

    names: list[str] = json.loads(GLYPH_LIST.read_text(encoding="utf-8"))
    if len(names) != len(set(names)):
        raise SystemExit("FATAL: scripts/material-symbols-glyphs.json contains duplicate names.")

    source_bytes = SOURCE_FONT.stat().st_size
    font = TTFont(str(SOURCE_FONT))

    if "fvar" not in font:
        raise SystemExit("FATAL: source font has no fvar table -- it is not a variable font.")
    source_axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in font["fvar"].axes}
    print(f"Source font axes: {source_axes}")
    required_axes = {"FILL", "GRAD", "opsz", "wght"}
    missing_axes = required_axes - source_axes.keys()
    if missing_axes:
        raise SystemExit(f"FATAL: source font is missing required axes: {missing_axes}")

    codepoints = resolve_codepoints(font, names)
    print(f"Resolved {len(codepoints)}/{len(names)} requested glyph names to codepoints.")

    unicodes = sorted(set(codepoints.values()))
    print(f"Subsetting to {len(unicodes)} unique codepoints (some names may share a codepoint)...")

    options = Options()
    options.flavor = "woff2"
    options.no_hinting = True
    options.layout_features = []  # rendered by codepoint only; no GSUB/ligature needed
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    options.recalc_timestamp = False
    options.desubroutinize = False  # glyf-based (TrueType), not CFF -- nothing to desubroutinize

    subsetter = Subsetter(options=options)
    subsetter.populate(unicodes=unicodes)
    subsetter.subset(font)

    if "fvar" not in font:
        raise SystemExit(
            "FATAL: fvar table was dropped during subsetting -- the variable axes did not "
            "survive. This would silently make FILL a no-op everywhere in the app."
        )
    out_axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in font["fvar"].axes}
    if out_axes != source_axes:
        raise SystemExit(
            f"FATAL: fvar axes changed during subsetting.\n  before: {source_axes}\n"
            f"  after:  {out_axes}\nThe subset must preserve every axis exactly."
        )
    for required_table in ("gvar", "avar", "HVAR", "STAT"):
        if required_table not in font:
            print(
                f"NOTE: '{required_table}' not present after subsetting (it may not have "
                "existed in the source, or fontTools dropped it because it became empty).",
                file=sys.stderr,
            )

    OUTPUT_FONT.parent.mkdir(parents=True, exist_ok=True)
    font.save(str(OUTPUT_FONT))
    out_bytes = OUTPUT_FONT.stat().st_size

    # Verify every requested codepoint actually resolves to a real glyph in the SAVED subset,
    # by reloading it fresh from disk -- never trust the in-memory object we just subsetted.
    verify_font = TTFont(str(OUTPUT_FONT))
    verify_cmap: dict[int, str] = {}
    for table in verify_font["cmap"].tables:
        verify_cmap.update(table.cmap)
    missing_after = [(name, hex(cp)) for name, cp in codepoints.items() if cp not in verify_cmap]
    if missing_after:
        raise SystemExit(f"FATAL: codepoints missing from the SAVED subset: {missing_after}")

    verify_axes = {
        a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in verify_font["fvar"].axes
    }
    if verify_axes != source_axes:
        raise SystemExit(
            f"FATAL: re-loaded saved subset has different fvar axes than the source: {verify_axes}"
        )
    print(f"Verified (reloaded from disk): fvar axes intact = {verify_axes}")
    print(f"Verified (reloaded from disk): all {len(codepoints)} codepoints map to real glyphs.")

    manifest = {
        "sourcePackage": "material-symbols",
        "sourcePackageVersion": "0.46.0",
        "sourceFont": "material-symbols-rounded.woff2 (Rounded variant)",
        "generatedBy": "scripts/subset-material-symbols.py",
        "sourceBytes": source_bytes,
        "outputBytes": out_bytes,
        "axes": {
            tag: {"min": lo, "default": d, "max": hi} for tag, (lo, d, hi) in verify_axes.items()
        },
        "aliasesApplied": KNOWN_MISSING_ALIASES,
        "glyphs": {name: f"U+{cp:04X}" for name, cp in sorted(codepoints.items())},
    }
    MANIFEST_OUT.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print(f"\nSource:  {source_bytes:,} bytes")
    print(f"Output:  {out_bytes:,} bytes ({out_bytes / source_bytes:.1%} of source)")
    print(f"Wrote:   {OUTPUT_FONT.relative_to(REPO_ROOT)}")
    print(f"Wrote:   {MANIFEST_OUT.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
