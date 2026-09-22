"""Shared utilities for audio script transforms.

Pure text-level rules — inline cleaning, normalization, helpers, post-processing —
that apply identically across every era The Weekly Thing has been published on.
Era-specific modules (modern.py, legacy.py) supply the section vocabulary and
parsing strategy; this module is what they both stand on.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

HTML_COMMENT_RE = re.compile(r"<!--[\s\S]*?-->")
FENCED_CODE_RE = re.compile(r"^(```|~~~)[\s\S]*?^\1\s*$", re.MULTILINE)
# URL portion may contain escaped parens (`\(film\)`) OR a single level of
# nested unescaped parens (`(computer_science)`) — both common for Wikipedia
# disambiguation links. The `(?:...)` alternation handles all three cases:
# normal char, escaped sequence, or a parenthesized group.
_URL_PORTION = r"(?:[^()\\]|\\.|\([^)]*\))+"
IMAGE_RE = re.compile(rf"!\[[^\]]*]\({_URL_PORTION}\)")
LINK_RE = re.compile(rf"(?<!!)\[([^\]]+)]\(({_URL_PORTION})\)")
HTML_TAG_RE = re.compile(r"<[^>]+>")
BARE_URL_RE = re.compile(r"https?://\S+")

# Cover/photo block: an `---`/`---` separator pair that opens with an
# image. The block holds a caption + dateline + location and has no value
# in audio (the alt text, caption, and location should never be spoken).
# Required shape:
#   ---
#   ![alt](src)              <- markdown image (legacy issues), OR
#   <img ... src="..." />    <- native HTML image (modern issues, post-2026)
#   <up to ~12 lines of caption/metadata>
#   ---
#
# The image must be the first non-blank line inside the fences. Both
# the markdown and native-HTML forms are matched so the cover block —
# along with whatever alt-text / caption / dateline / location it
# carries — gets dropped on its way to the audio script.
COVER_BLOCK_RE = re.compile(
    r"^-{3,}[ \t]*\n"
    r"(?:[ \t]*\n)*"
    r"[ \t]*(?:!\[[^\]]*]\([^)]+\)|<img\b[^>]*/?>)[ \t]*\n"
    r"(?:[^\n]*\n){0,12}"
    r"-{3,}[ \t]*$",
    re.MULTILINE,
)

# Journal-style date-time stamp on its own line, optionally wrapped as
# a markdown link to a permalink. Examples:
#   [Apr 17, 2026 at 7:47 PM](https://...)
#   Apr 20, 2026 at 7:52 PM
_MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec"
JOURNAL_DATE_RE = re.compile(
    rf"^\s*(?:\[)?(?:{_MONTHS})[a-z]*\s+\d{{1,2}},?\s+\d{{4}}"
    r"\s+at\s+\d{1,2}:\d{2}\s*(?:[AaPp]\.?[Mm]\.?)\s*\]?(?:\([^)]+\))?\s*$"
)

BRIEFLY_LINK_RE = re.compile(r"\*\*\[([^\]]+)]\([^)]+\)\*\*")
STRIKETHROUGH_HTML_RE = re.compile(
    r"<(strike|del|s)\b[^>]*>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)

NORMALIZER_REPLACEMENTS = [
    (re.compile(r"\be\.g\.", re.IGNORECASE), "for example"),
    (re.compile(r"\bi\.e\.", re.IGNORECASE), "that is"),
    (re.compile(r"\bvs\.", re.IGNORECASE), "versus"),
    (re.compile(r"\bvs\b", re.IGNORECASE), "versus"),
    (re.compile(r"&"), " and "),
]

ORDINALS = {
    "1st": "first",
    "2nd": "second",
    "3rd": "third",
    "4th": "fourth",
    "5th": "fifth",
    "6th": "sixth",
    "7th": "seventh",
    "8th": "eighth",
    "9th": "ninth",
    "10th": "tenth",
    "11th": "eleventh",
    "12th": "twelfth",
    "13th": "thirteenth",
    "14th": "fourteenth",
    "15th": "fifteenth",
    "16th": "sixteenth",
    "17th": "seventeenth",
    "18th": "eighteenth",
    "19th": "nineteenth",
    "20th": "twentieth",
    "21st": "twenty first",
    "22nd": "twenty second",
    "23rd": "twenty third",
    "24th": "twenty fourth",
    "25th": "twenty fifth",
    "26th": "twenty sixth",
    "27th": "twenty seventh",
    "28th": "twenty eighth",
    "29th": "twenty ninth",
    "30th": "thirtieth",
    "31st": "thirty first",
}

YEAR_WORDS = {
    2000: "two thousand",
    2001: "two thousand one",
    2002: "two thousand two",
    2003: "two thousand three",
    2004: "two thousand four",
    2005: "two thousand five",
    2006: "two thousand six",
    2007: "two thousand seven",
    2008: "two thousand eight",
    2009: "two thousand nine",
    2010: "twenty ten",
    2011: "twenty eleven",
    2012: "twenty twelve",
    2013: "twenty thirteen",
    2014: "twenty fourteen",
    2015: "twenty fifteen",
    2016: "twenty sixteen",
    2017: "twenty seventeen",
    2018: "twenty eighteen",
    2019: "twenty nineteen",
    2020: "twenty twenty",
    2021: "twenty twenty one",
    2022: "twenty twenty two",
    2023: "twenty twenty three",
    2024: "twenty twenty four",
    2025: "twenty twenty five",
    2026: "twenty twenty six",
    2027: "twenty twenty seven",
    2028: "twenty twenty eight",
    2029: "twenty twenty nine",
}

_HEART_EMOJI_RE = re.compile(
    r"(?:[❤♥\U0001F49B\U0001F49A\U0001F499\U0001F49C\U0001F5A4\U0001F90D\U0001F90E\U0001F9E1]️?)+"
)
# Heart only acts as the verb "love" when followed by space + a word.
# At end of sentence/line it's decorative — strip without "love".
_HEART_AS_VERB_RE = re.compile(
    r"(?:[❤♥\U0001F49B\U0001F49A\U0001F499\U0001F49C\U0001F5A4\U0001F90D\U0001F90E\U0001F9E1]️?)+(?=\s+[A-Za-z])"
)


def strip_emoji(text: str) -> str:
    # First, replace verb-position hearts ("I ❤️ X") with the word "love".
    text = _HEART_AS_VERB_RE.sub(" love", text)
    # Any remaining hearts are decorative ("Lovely day! ❤️") — just strip.
    text = _HEART_EMOJI_RE.sub("", text)
    return "".join(
        char
        for char in text
        if not (
            0x1F000 <= ord(char) <= 0x1FAFF
            or 0x2300
            <= ord(char)
            <= 0x24FF  # misc technical (⌚, ⌛, etc.) + enclosed alphanumerics
            or 0x2600 <= ord(char) <= 0x27BF
            or 0x2B00 <= ord(char) <= 0x2BFF  # misc symbols and arrows
            or ord(char) == 0xFE0F  # variation selector
            or ord(char) == 0x200D  # zero-width joiner (used in compound emoji)
            or ord(char) == 0x2060  # word joiner
        )
    )


def clean_inline(text: str) -> str:
    text = IMAGE_RE.sub("", text)
    text = LINK_RE.sub(r"\1", text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    # Asterisk emphasis: *text*, **text**, ***text***. Use `\*+` (any run)
    # so unbalanced source like `**Solo**](url)**` doesn't leave a stray `*`.
    # Pad with spaces in case the source had no whitespace separator
    # (`**democracy**and` → ` democracy and`); the later whitespace-collapse
    # step cleans up.
    text = re.sub(r"\*+([^*]+)\*+", r" \1 ", text)
    # Underscore emphasis: only treat `_` as a delimiter when it's NOT part of
    # an identifier (e.g. `schema_version`, `group_concat`). Word characters
    # on either side mean the underscore is intra-word.
    text = re.sub(r"(?<![A-Za-z0-9_])_{1,3}([^_\n]+?)_{1,3}(?![A-Za-z0-9_])", r"\1", text)
    # Italic phrases with internal whitespace and a sloppy closing underscore
    # (`_Calvin and Hobbes _showed me`). Strict pass above misses these because
    # the closing `_` touches a letter. Spaces inside the wrapped content
    # signal a phrase, not an identifier — safe to strip.
    text = re.sub(r"(?<![A-Za-z0-9_])_{1,3}([^_\n]*\s[^_\n]*)_{1,3}", r"\1", text)
    # Strip leftover bold markers from multi-line spans (e.g. a haiku wrapped
    # in **...** across three lines).
    text = re.sub(r"\*{2,3}", "", text)
    text = HTML_TAG_RE.sub(" ", text)
    text = BARE_URL_RE.sub("", text)
    text = text.replace("\\|", "|")
    text = text.replace("\\", "")
    # Inline `>` blockquote markers that didn't make it onto their own line in
    # the source — strip when they sit between sentences.
    text = re.sub(r"([.!?])\s+>\s+", r"\1 ", text)
    # Strip inline emoji — TTS would otherwise speak the unicode names
    # ("smiling face with smiling eyes"), which is jarring in prose.
    text = strip_emoji(text)
    # Strip unicode arrows — used in old micro-posts as link separators
    # ("commentary. → title") and in Tinyletter-era end-of-bullet markers.
    text = re.sub(r"\s*[→⟶⇒]\s*", " ", text)
    return normalize_text(text)


def normalize_text(text: str) -> str:
    for pattern, replacement in NORMALIZER_REPLACEMENTS:
        text = pattern.sub(replacement, text)
    text = DOLLAR_AMOUNT_RE.sub(_replace_dollars, text)
    # Source sometimes writes "$50 million dollars" redundantly. After
    # normalization that becomes "50 million dollars dollars". Collapse.
    text = re.sub(
        r"\b(thousand|million|billion|trillion)\s+dollars\s+dollars\b",
        r"\1 dollars",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"\b([1-9]|[12]\d|3[01])(st|nd|rd|th)\b",
        lambda m: ORDINALS.get(m.group(0).lower(), m.group(0)),
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"\b(20[0-2]\d)\b", lambda m: YEAR_WORDS.get(int(m.group(1)), m.group(1)), text)
    text = re.sub(r"[ \t]+", " ", text)
    # Collapse a leading space before punctuation only when the punctuation is
    # actually terminal (followed by whitespace/punctuation/EOL). This keeps
    # leading-dot tokens like ".feedback", ".net", ".com" from being merged
    # with the previous word ("The .feedback scam" stays intact).
    text = re.sub(r" +([,.;:!?])(?=[\s\W]|$)", r"\1", text)
    return text.strip()


# Match `$<int>(.<frac>)?` optionally followed by a magnitude word or
# letter (K/M/B/T or thousand/million/billion/trillion). Captures groups:
#   1 = whole dollars (may include commas)
#   2 = fractional digits (1+ digits) or None
#   3 = magnitude word/letter or None
DOLLAR_AMOUNT_RE = re.compile(
    r"\$(\d[\d,]*)(?:\.(\d+))?(?:\s*(thousand|million|billion|trillion|trn|bn|tn|mn|[KMBT]))?\b",
    re.IGNORECASE,
)

_MAGNITUDE_WORDS = {
    "k": "thousand",
    "m": "million",
    "b": "billion",
    "t": "trillion",
    "bn": "billion",
    "mn": "million",
    "tn": "trillion",
    "trn": "trillion",
    "thousand": "thousand",
    "million": "million",
    "billion": "billion",
    "trillion": "trillion",
}


def _replace_dollars(match: re.Match[str]) -> str:
    dollars = match.group(1)
    frac = match.group(2)
    magnitude_raw = (match.group(3) or "").strip().lower()
    magnitude = _MAGNITUDE_WORDS.get(magnitude_raw) if magnitude_raw else None

    if magnitude:
        # "$2.5 billion" → "2.5 billion dollars"; "$9M" → "9 million dollars".
        number = dollars + (f".{frac}" if frac else "")
        return f"{number} {magnitude} dollars"

    if frac is not None:
        if len(frac) == 2:
            # "$50.25" → "50 dollars and 25 cents"; "$50.00" → "50 dollars".
            amount = f"{dollars} dollar" + ("" if dollars == "1" else "s")
            if frac != "00":
                amount += f" and {int(frac)} cents"
            return amount
        # Single-decimal or odd-length fractional with no magnitude word —
        # rare in prose but read it as "<n> point <frac> dollars".
        return f"{dollars} point {frac} dollars"

    return f"{dollars} dollar" + ("" if dollars == "1" else "s")


def heading_text(raw: str) -> str:
    """Normalize an H2/H3 heading: strip markdown, emoji, and trailing dots."""
    text = clean_inline(raw)
    text = strip_emoji(text)
    text = re.sub(r"\s+", " ", text).strip(" .")
    return text


def published_date(value: Any) -> str:
    if not value:
        return ""
    raw = str(value).replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return str(value)
    return parsed.strftime("%B %-d, %Y")


def preamble(frontmatter: dict[str, Any]) -> str:
    number = frontmatter.get("number", "")
    subject = strip_emoji((frontmatter.get("subject") or "").strip()).strip()
    # The subject typically reads "Weekly Thing 345 / Codex, Headless,
    # Wikiwise". Drop the prefix duplicate and keep only the topical
    # tail so the audio doesn't say the issue number twice.
    if " / " in subject:
        subject = subject.rsplit(" / ", 1)[1].strip()
    date = published_date(frontmatter.get("publish_date", ""))
    description = strip_emoji((frontmatter.get("description") or "").strip()).strip()
    parts = [f"The Weekly Thing, issue {number}."]
    if subject:
        parts.append(subject.rstrip(".") + ".")
    parts.extend([f"Published {date}.", "By Jamie Thingelstad."])
    if description:
        intro = description.rstrip(".") + "."
        parts.extend(["In this issue:", intro])
    return normalize_text(" ".join(parts))


def closing(frontmatter: dict[str, Any]) -> str:
    number = frontmatter.get("number", "")
    return normalize_text(
        f"That brings us to the end of the Weekly Thing, issue {number}. "
        "Thanks for listening, and I'll see you next time."
    )


def strip_cover_blocks(body: str) -> str:
    return COVER_BLOCK_RE.sub("", body)


_INTRO_LINE_RE = re.compile(
    r"^Now, the .+? section\.$|^Now, more links\.$|^Now, for your information\.$"
)
_END_LINE_RE = re.compile(r"^That's the end of .+\.$")


def drop_empty_sections(lines: list[str]) -> list[str]:
    """Remove `Now, the X section.` followed only by blanks then `That's the end of X.`.

    These appear when an H2 section has no entries we keep — e.g. early MailChimp
    `## Links` dividers above sub-section H2s, or modern `## Supporting Membership`
    blocks where the content (Liquid templates + HTML CTAs) strips to nothing."""
    result = list(lines)
    i = 0
    while i < len(result):
        if result[i].strip() and _INTRO_LINE_RE.match(result[i].strip()):
            j = i + 1
            while j < len(result) and not result[j].strip():
                j += 1
            if j < len(result) and _END_LINE_RE.match(result[j].strip()):
                # Also consume one trailing blank if present so we don't leave
                # a double blank in its place.
                end = j + 1
                if end < len(result) and not result[end].strip():
                    end += 1
                del result[i:end]
                continue
        i += 1
    return result


_NUMBER_WORDS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
]

_TENS_WORDS = {
    20: "twenty",
    30: "thirty",
    40: "forty",
    50: "fifty",
    60: "sixty",
    70: "seventy",
    80: "eighty",
    90: "ninety",
}


def number_word(n: int) -> str:
    if 0 <= n < len(_NUMBER_WORDS):
        return _NUMBER_WORDS[n]
    if 21 <= n <= 99:
        tens = (n // 10) * 10
        ones = n % 10
        if ones == 0:
            return _TENS_WORDS[tens]
        return f"{_TENS_WORDS[tens]} {_NUMBER_WORDS[ones]}"
    return str(n)


def finalize_script(output: list[str]) -> str:
    """Final-pass cleanup shared by every era: drop empty sections, lone-emoji
    decorative lines, then collapse runs of blank lines."""
    output = drop_empty_sections(output)
    cleaned: list[str] = []
    for entry in output:
        # Lines that strip to nothing after emoji removal are decorative
        # ("👋", "👨‍💻") — TTS would otherwise speak their unicode names.
        if entry and not strip_emoji(entry).strip():
            continue
        cleaned.append(entry)
    script = "\n".join(cleaned)
    script = re.sub(r"\n{3,}", "\n\n", script)
    return script.strip() + "\n"
