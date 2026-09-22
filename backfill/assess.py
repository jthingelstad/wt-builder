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


def norm(t: str) -> list[str]:
    t = t.lower().replace("’", "'")
    t = re.sub(r"[^a-z0-9' ]+", " ", t)
    return t.split()


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
    for issue in sys.argv[1:]:
        print(assess(issue))
        print()
