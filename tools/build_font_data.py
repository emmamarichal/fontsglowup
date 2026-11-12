"""Build data/glyphsets.json and data/languages.json, read by js/fontinfo.js.

  pip install glyphsets gflanguages
  python tools/build_font_data.py

glyphsets.json   the Google Fonts glyphsets the tool measures, as code points
languages.json   every living language of gflanguages with its letters
                 (base exemplar characters), to count the languages a font supports
"""
import json
import os
import unicodedata

import glyphsets
from gflanguages import LoadLanguages

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SETS = ["GF_Latin_Kernel", "GF_Latin_Core", "GF_Latin_Plus", "GF_Latin_Vietnamese", "GF_Latin_Pro",
        "GF_Cyrillic_Core", "GF_Cyrillic_Plus", "GF_Cyrillic_Pro", "GF_Greek_Core", "GF_Greek_Plus", "GF_Greek_Pro",
        "GF_Arabic_Core", "GF_Arabic_Plus"]


def main():
    sets = {}
    for name in SETS:
        if name not in glyphsets.defined_glyphsets():
            continue
        cps = sorted(c for c in glyphsets.unicodes_per_glyphset(name) if c and c > 0x20)
        sets[name] = cps
    # each level includes the one below it (GF Latin Plus = Core + its own glyphs…)
    for chain in (["GF_Latin_Kernel", "GF_Latin_Core", "GF_Latin_Plus", "GF_Latin_Pro"],
                  ["GF_Cyrillic_Core", "GF_Cyrillic_Plus", "GF_Cyrillic_Pro"],
                  ["GF_Greek_Core", "GF_Greek_Plus", "GF_Greek_Pro"],
                  ["GF_Arabic_Core", "GF_Arabic_Plus"]):
        prev = set()
        for name in chain:
            if name in sets:
                prev |= set(sets[name])
                sets[name] = sorted(prev)
    langs = {}
    for lid, l in LoadLanguages().items():
        base = l.exemplar_chars.base
        if not base or l.historical:
            continue
        chars = sorted({ch for tok in base.split() for ch in tok.strip("{}")
                        if not unicodedata.category(ch).startswith("M") and not ch.isspace()})
        if chars:
            langs[lid] = [l.name, l.script, l.population, "".join(chars)]
    with open(os.path.join(ROOT, "data", "glyphsets.json"), "w", encoding="utf-8") as fh:
        json.dump(sets, fh, separators=(",", ":"))
    with open(os.path.join(ROOT, "data", "languages.json"), "w", encoding="utf-8") as fh:
        json.dump(langs, fh, ensure_ascii=False, separators=(",", ":"))
    print(len(sets), "glyphsets,", len(langs), "languages")


if __name__ == "__main__":
    main()
