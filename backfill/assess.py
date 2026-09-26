"""Assess a rendered back-catalogue issue against what whisper hears.

    python3 backfill/assess.py <dir> [<dir> ...]

For each directory holding one issue's .mp3/.vtt pair (the runner's --dry
output, or a downloaded published render), a whisper
transcript (mlx-whisper large-v3-turbo, word timestamps) made if missing, then:
  - every VTT cue matched to the words heard inside its window; cues whose
    heard text diverges are listed (script vs heard);
  - the pause actually heard before every section opener / closer / close;
  - words per minute, duration, cue count.
Writes <dir>/assessment.txt and prints it.
"""
from __future__ import annotations

import difflib
import glob
import json
import os
import re
import subprocess
import sys

MODEL = "mlx-community/whisper-large-v3-turbo"

OPENER = re.compile(r"^(Now, |That's the end of |That brings us to the end|The Weekly Thing, )")


def clock(s: str) -> float:
    h, m, rest = s.split(":")
    return int(h) * 3600 + int(m) * 60 + float(rest)


def parse_vtt(path: str) -> list[dict]:
    cues = []
    block: list[str] = []
    for line in open(path, encoding="utf-8").read().split("\n") + [""]:
        if line.strip():
            block.append(line)
            continue
        if not block:
            continue
        times = next((l for l in block if "-->" in l), None)
        if times:
            a, b = [t.strip() for t in times.split("-->")]
            text = " ".join(l for l in block[block.index(times) + 1 :])
            text = re.sub(r"^<v [^>]*>", "", text).strip()
            cues.append({"start": clock(a), "end": clock(b.split()[0]), "text": text})
        block = []
    return cues


ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
ORDINAL = {"one": "first", "two": "second", "three": "third", "five": "fifth", "eight": "eighth",
           "nine": "ninth", "twelve": "twelfth"}


def spell(n: int) -> str:
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000:
        return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + spell(n % 100))
    if 2000 <= n < 2100:  # a year, as it is said: "twenty twenty-six"
        return "twenty " + ("hundred" if n == 2000 else spell(n % 100) if n % 100 >= 10 else "oh " + spell(n % 100))
    if n < 10000:
        return spell(n // 1000) + " thousand" + ("" if n % 1000 == 0 else " " + spell(n % 1000))
    return str(n)


def ordinal(words: str) -> str:
    head, _, last = words.rpartition(" ")
    if last in ORDINAL:
        last = ORDINAL[last]
    elif last.endswith("y"):
        last = last[:-1] + "ieth"
    else:
        last += "th"
    return (head + " " + last).strip()


def words_for(token: str) -> str:
    """Whisper writes "21st" and "2026" where the script says "twenty-first":
    the same words, so both sides are compared spelled out (WT351 flagged
    every Journal date otherwise)."""
    m = re.fullmatch(r"(\d{1,4})(st|nd|rd|th)?", token)
    if not m:
        return token
    n = int(m.group(1))
    return ordinal(spell(n)) if m.group(2) else spell(n)


def norm(t: str) -> list[str]:
    t = t.lower().replace("’", "'")
    t = re.sub(r"(?<=\d),(?=\d{3})", "", t)
    t = re.sub(r"[^a-z0-9' ]+", " ", t)
    return " ".join(words_for(w) for w in t.split()).split()


CHUNK_S = 240


def transcribe(mp3: str, outdir: str) -> dict:
    """Whisper, decoded in 4-minute chunks with fresh context each: on a whole
    file it can lock onto a phrase and repeat it for minutes (WT5, 2026-09-22,
    on the script's own one-word sentence "Mesmerizing."). Word times are
    offset back to the whole file; the result is cached beside the mp3."""
    base = os.path.splitext(os.path.basename(mp3))[0]
    js = os.path.join(outdir, base + ".chunked.json")
    if os.path.exists(js):
        return json.load(open(js, encoding="utf-8"))
    total = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                  "-of", "default=noprint_wrappers=1:nokey=1", mp3],
                                 capture_output=True, text=True, check=True).stdout.strip())
    segments = []
    start = 0.0
    while start < total:
        clip = os.path.join(outdir, f"_chunk-{int(start):05d}.mp3")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", str(start),
                        "-t", str(CHUNK_S), "-i", mp3, clip], check=True)
        subprocess.run(
            ["uvx", "--from", "mlx-whisper", "mlx_whisper", clip, "--model", MODEL,
             "--output-format", "json", "--output-dir", outdir, "--word-timestamps", "True",
             "--language", "en"],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        part = json.load(open(clip[:-4] + ".json", encoding="utf-8"))
        for seg in part["segments"]:
            seg["start"] += start
            seg["end"] += start
            for w in seg.get("words", []):
                w["start"] += start
                w["end"] += start
            segments.append(seg)
        os.remove(clip)
        os.remove(clip[:-4] + ".json")
        start += CHUNK_S
    out = {"segments": segments}
    json.dump(out, open(js, "w", encoding="utf-8"))
    return out


def hear_alone(mp3: str, start: float, end: float, outdir: str) -> str:
    """One cue cut out and heard on its own. Inside a four-minute chunk whisper
    can drop a short cue's first word ("Hello there!" heard as "there." in
    WT351); alone, it hears what was said."""
    clip = os.path.join(outdir, "_cue.wav")
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{max(0.0, start - 0.3):.2f}",
                    "-t", f"{end - start + 0.7:.2f}", "-i", mp3, clip], check=True)
    subprocess.run(["uvx", "--from", "mlx-whisper", "mlx_whisper", clip, "--model", MODEL,
                    "--output-format", "txt", "--output-dir", outdir, "--language", "en"],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    heard = open(clip[:-4] + ".txt", encoding="utf-8").read().strip()
    os.remove(clip)
    os.remove(clip[:-4] + ".txt")
    return heard


RECHECK_MAX = 8


def assess_json(d: str) -> dict:
    """The same listening, as data, for WT Builder's publish verification.
    Every suspect cue is heard again on its own; one that then matches is
    cleared, and only what stays suspect counts against the render."""
    mp3 = sorted(glob.glob(os.path.join(d, "weekly-thing-*.mp3")))[-1]
    cues = parse_vtt(mp3[:-4] + ".vtt")
    heard = transcribe(mp3, d)
    words = [w for seg in heard["segments"] for w in seg.get("words", [])]
    total = float(heard["segments"][-1]["end"]) if heard["segments"] else 0.0
    ratios, suspects = [], []
    for c in cues:
        inside = [w["word"] for w in words if w["start"] >= c["start"] - 0.25 and w["end"] <= c["end"] + 0.35]
        a, b = norm(c["text"]), norm(" ".join(inside))
        r = difflib.SequenceMatcher(None, a, b).ratio() if a else 1.0
        ratios.append(r)
        if r < 0.72 or (len(a) >= 3 and len(b) == 0):
            suspects.append({"ratio": round(r, 2), "at": round(c["start"], 1), "script": c["text"][:200],
                             "heard": " ".join(inside)[:200], "_c": c})
    for s in sorted(suspects, key=lambda x: x["ratio"])[:RECHECK_MAX]:
        alone = hear_alone(mp3, s["_c"]["start"], s["_c"]["end"], d)
        r = difflib.SequenceMatcher(None, norm(s["_c"]["text"]), norm(alone)).ratio()
        s["alone"], s["alone_ratio"], s["cleared"] = alone[:200], round(r, 2), r >= 0.72
    for s in suspects:
        s.pop("_c")
        s.setdefault("cleared", False)
    pauses = []
    for i, c in enumerate(cues):
        if i == 0 or not OPENER.match(c["text"]):
            continue
        first = next((w for w in words if w["start"] >= c["start"] - 0.6), None)
        prev = max((w for w in words if w["end"] <= (first["start"] if first else c["start"])), key=lambda w: w["end"], default=None)
        gap = (first["start"] - prev["end"]) if first and prev else None
        pauses.append({"placed": round(c["start"] - cues[i - 1]["end"], 2), "heard": None if gap is None else round(gap, 2),
                       "at": round(c["start"], 1), "text": c["text"][:80]})
    return {
        "duration": round(total, 1), "cues": len(cues), "words": len(words),
        "wpm": round(len(words) / (total / 60)) if total else 0,
        "median": round(sorted(ratios)[len(ratios) // 2], 2) if ratios else 0,
        "matched": sum(1 for r in ratios if r >= 0.72),
        "suspects": suspects, "pauses": pauses,
    }


def assess(d: str) -> str:
    issue = os.path.basename(os.path.normpath(d))
    mp3 = sorted(glob.glob(os.path.join(d, "weekly-thing-*.mp3")))[-1]
    vtt = mp3[:-4] + ".vtt"
    cues = parse_vtt(vtt)
    heard = transcribe(mp3, d)
    words = [w for seg in heard["segments"] for w in seg.get("words", [])]
    total = float(heard["segments"][-1]["end"]) if heard["segments"] else 0.0

    lines = [f"# {issue}: {os.path.basename(mp3)}", f"duration {total/60:.1f} min, {len(cues)} cues, "
             f"{len(words)} words heard, {len(words)/(total/60):.0f} wpm", ""]

    # 1. cue by cue: what was heard inside the cue's window
    suspects = []
    ratios = []
    for c in cues:
        inside = [w["word"] for w in words if w["start"] >= c["start"] - 0.25 and w["end"] <= c["end"] + 0.35]
        a, b = norm(c["text"]), norm(" ".join(inside))
        r = difflib.SequenceMatcher(None, a, b).ratio() if a else 1.0
        ratios.append(r)
        if r < 0.72 or (len(a) >= 3 and len(b) == 0):
            suspects.append((r, c, " ".join(inside)))
    lines.append(f"## Cues heard as written: median match {sorted(ratios)[len(ratios)//2]:.2f}, "
                 f"{sum(1 for r in ratios if r >= 0.72)}/{len(ratios)} at or above 0.72")
    lines.append("")
    if suspects:
        lines.append("## Suspect cues (script → heard)")
        for r, c, h in sorted(suspects, key=lambda x: x[0])[:25]:
            lines.append(f"- {r:.2f} @{c['start']/60:05.2f}  SCRIPT: {c['text'][:150]}")
            lines.append(f"              HEARD:  {h[:150]}")
        lines.append("")

    # 2. pauses before the structural cues, as heard
    lines.append("## Pause heard before openers / closers / close (script placed → heard)")
    for i, c in enumerate(cues):
        if i == 0 or not OPENER.match(c["text"]):
            continue
        placed = c["start"] - cues[i - 1]["end"]
        first = next((w for w in words if w["start"] >= c["start"] - 0.6), None)
        prev = max((w for w in words if w["end"] <= (first["start"] if first else c["start"])), key=lambda w: w["end"], default=None)
        heard_gap = (first["start"] - prev["end"]) if first and prev else float("nan")
        lines.append(f"- {placed:4.1f}s → {heard_gap:4.1f}s  @{c['start']/60:05.2f} {c['text'][:60]}")
    lines.append("")
    text = "\n".join(lines)
    open(os.path.join(d, "assessment.txt"), "w", encoding="utf-8").write(text)
    return text


if __name__ == "__main__":
    if sys.argv[1:2] == ["--json"]:
        print(json.dumps(assess_json(sys.argv[2])))
        sys.exit(0)
    for issue in sys.argv[1:]:
        print(assess(issue))
        print()
