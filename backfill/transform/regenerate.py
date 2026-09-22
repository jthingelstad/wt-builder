"""Regenerate the spoken scripts from the archive Markdown.

    python3 backfill/transform/regenerate.py [--out DIR] [N ...]

Reads ``../weekly.thingelstad.com/apps/site/archive/<N>.md`` (the sibling
repository, by relative path), splits the front matter, and runs the era
transform. With no numbers, every issue the archive has. Output goes to
``backfill/scripts/`` unless ``--out`` says otherwise — regenerate into a
scratch directory and diff against the committed scripts to see exactly what a
transform change did.

Only the front-matter keys the transform reads are parsed (number, subject,
publish_date, description), which keeps this free of a YAML dependency.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from transform import body_to_audio_script  # noqa: E402

HERE = Path(__file__).resolve().parent
ARCHIVE = HERE.parent.parent.parent / "weekly.thingelstad.com" / "apps" / "site" / "archive"
SCRIPTS = HERE.parent / "scripts"
# Issues from 350 on are authored in WT Builder and spoken from their
# document; the archive's copy of them is not a script source.
LAST_LEGACY_ISSUE = 349
KEYS = ("number", "subject", "publish_date", "description")


def split_front_matter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        raise ValueError("no front matter")
    end = text.index("\n---\n", 4)
    front, body = text[4:end], text[end + 5 :]
    meta: dict[str, str] = {}
    for line in front.split("\n"):
        m = re.match(r"^(%s):\s*(.*)$" % "|".join(KEYS), line)
        if not m:
            continue
        value = m.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            inner = value[1:-1]
            value = inner.replace("''", "'") if value[0] == "'" else inner.replace('\\"', '"')
        meta[m.group(1)] = value
    # The number is an int for ordinary issues and a string for 140-special.
    number = meta.get("number", "")
    meta["number"] = int(number) if number.isdigit() else number  # type: ignore[assignment]
    return meta, body


def main(argv: list[str]) -> int:
    out = SCRIPTS
    names: list[str] = []
    it = iter(argv)
    for arg in it:
        if arg == "--out":
            out = Path(next(it))
        else:
            names.append(arg)
    if not names:
        names = sorted(
            p.stem for p in ARCHIVE.glob("*.md")
            if int(re.match(r"\d+", p.stem).group(0)) <= LAST_LEGACY_ISSUE
        )
    out.mkdir(parents=True, exist_ok=True)
    for name in names:
        src = ARCHIVE / f"{name}.md"
        meta, body = split_front_matter(src.read_text(encoding="utf-8"))
        script = body_to_audio_script(body, meta)
        (out / f"{name}.txt").write_text(script, encoding="utf-8")
    print(f"wrote {len(names)} scripts to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
