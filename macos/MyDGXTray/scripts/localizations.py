#!/usr/bin/env python3
"""Keeps Resources/{es,en}.lproj/Localizable.strings in step with the Swift sources.

Spanish literals in the code are the keys. The script asks the compiler for every
key (`-emit-localized-strings`), rewrites es.lproj as key = key, and checks that
en.lproj translates every key with the same format specifiers.

    scripts/localizations.py            # check; exit 1 if something is missing
    scripts/localizations.py --merge new.json   # add {"key": "English"} entries, then check
"""
import argparse
import collections
import glob
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESOURCES = ROOT / "Resources"
SPECIFIER = re.compile(r"%(?:\d+\$)?[-+ #0]*\d*(?:\.\d+)?(?:hh|h|ll|l|q|z|t|j)?[@dDiuUxXoOfFeEgGcCsSpaA%]")


def extract_keys() -> list[str]:
    with tempfile.TemporaryDirectory() as directory:
        subprocess.run(
            ["swift", "build", "-Xswiftc", "-emit-localized-strings",
             "-Xswiftc", "-emit-localized-strings-path", "-Xswiftc", directory],
            cwd=ROOT, check=True, stdout=subprocess.DEVNULL,
        )
        keys: dict[str, None] = {}
        files = sorted(glob.glob(f"{directory}/*.stringsdata"))
        sources = len(list((ROOT / "Sources/MyDGXTray").glob("*.swift")))
        if len(files) < sources:
            sys.exit(f"Solo {len(files)} de {sources} archivos emitieron claves; borra .build y repite.")
        for path in files:
            for entries in json.loads(Path(path).read_text()).get("tables", {}).values():
                for entry in entries:
                    keys.setdefault(entry["key"])
        return list(keys)


def read_strings(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    output = subprocess.run(["plutil", "-convert", "json", "-o", "-", str(path)], check=True, capture_output=True)
    return json.loads(output.stdout)


def quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\t", "\\t") + '"'


def write_strings(path: Path, table: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [f"{quote(key)} = {quote(value)};" for key, value in sorted(table.items(), key=lambda item: item[0].casefold())]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    subprocess.run(["plutil", "-lint", "-s", str(path)], check=True)


def specifiers(text: str) -> collections.Counter:
    return collections.Counter(re.sub(r"^%\d+\$", "%", match) for match in SPECIFIER.findall(text) if match != "%%")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--merge", type=Path, help="JSON object of new English translations")
    args = parser.parse_args()

    keys = extract_keys()
    english = read_strings(RESOURCES / "en.lproj/Localizable.strings")
    if args.merge:
        english.update(json.loads(args.merge.read_text()))

    write_strings(RESOURCES / "es.lproj/Localizable.strings", {key: key for key in keys})
    write_strings(RESOURCES / "en.lproj/Localizable.strings", {key: english[key] for key in keys if key in english})

    missing = [key for key in keys if key not in english]
    unused = sorted(set(english) - set(keys))
    broken = [key for key in keys if key in english and specifiers(key) != specifiers(english[key])]
    print(f"{len(keys)} claves · {len(missing)} sin traducir · {len(broken)} con formato distinto · {len(unused)} obsoletas eliminadas")
    for key in missing:
        print(f"  sin traducir: {key!r}")
    for key in broken:
        print(f"  formato distinto: {key!r} → {english[key]!r}")
    sys.exit(1 if missing or broken else 0)


if __name__ == "__main__":
    main()
