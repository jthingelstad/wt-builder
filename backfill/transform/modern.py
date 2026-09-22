"""Going-forward Buttondown audio script transform (#131+).

Assumes canonical Buttondown shape:
- Section names: ``## Featured``, ``## Notable``, ``## Briefly``,
  ``## Must Read``, ``## Journal``, plus topical/journal H2s like
  ``## Currently``, ``## Fortune``, ``## Photograph``, etc.
- H3 link cards under link sections: ``### [Title](url)``.
- Briefly-style links: ``**[Title](url)**`` with optional commentary.
- Reddit-discuss line, ``Signed by …`` crypto receipts, and
  ``Would you like to discuss …`` CTAs are stripped (Buttondown-only).

Does not handle the emoji-suffix heading variants ("Featured Links",
"Yet More Links"), ``## by Name`` subtitles, MailChimp template residue,
or bare-URL-only paragraphs. See ``legacy.py`` for those.
"""

from __future__ import annotations

import re
from typing import Any

from .common import (
    BRIEFLY_LINK_RE,
    FENCED_CODE_RE,
    HTML_COMMENT_RE,
    IMAGE_RE,
    JOURNAL_DATE_RE,
    STRIKETHROUGH_HTML_RE,
    clean_inline,
    closing,
    finalize_script,
    heading_text,
    number_word,
    preamble,
    strip_cover_blocks,
)

# Section vocabulary — Buttondown canonical only. Other H2s ("Currently",
# "Fortune", "Photograph", topical one-offs) fall through to the default
# intro/label.
HEADING_INTROS = {
    "Featured": "Now, the Featured section.",
    "Notable": "Now, the Notable section.",
    "Must Read": "Now, the Must Read section.",
    "Briefly": "Now, the Briefly section.",
    "Recommended Links": "Now, the Recommended Links section.",
    "FYI": "Now, for your information.",
    "Journal": "Now, the Journal section.",
    "Echoes": "And to close, a note from the archive.",
}

HEADING_LABELS = {
    "Featured": "Featured",
    "Notable": "Notable",
    "Must Read": "Must Read",
    "Briefly": "Briefly",
    "Recommended Links": "Recommended Links",
    "FYI": "the FYI section",
    "Journal": "the Journal",
    "Echoes": "Echoes",
}

LINK_SECTIONS = {"Featured", "Notable", "Must Read"}
BRIEFLY_SECTIONS = {"Briefly", "Recommended Links", "FYI"}
JOURNAL_SECTIONS = {"Journal"}

# `_You can discuss... [r/WeeklyThing](...)._` opens recent Notable sections —
# audio shouldn't push readers off to Reddit.
REDDIT_DISCUSS_RE = re.compile(
    r"^[ \t]*_You can discuss any of these links at the "
    r"\[[^\]]*r/WeeklyThing[^\]]*]\([^)]+\)\._[ \t]*$",
    re.MULTILINE,
)

# `Signed by name.eth: 0x...` — TTS would spell every hex digit.
SIGNED_BY_RE = re.compile(
    r"^[ \t]*Signed by [^:\n]+:\s*0x[0-9a-fA-F]+[ \t]*$",
    re.MULTILINE,
)


def heading_intro(raw: str) -> str:
    text = heading_text(raw)
    return HEADING_INTROS.get(text, f"Now, the {text} section.")


def heading_label(raw: str) -> str:
    text = heading_text(raw)
    return HEADING_LABELS.get(text, text)


# H3 link card under a link section: ``### [Title](url)``.
_H3_LINK_RE = re.compile(r"^###\s+\[([^\]]+)]\([^)]+\)\s*$")


def _count_links_per_section(body: str) -> dict[str, int]:
    """Scan the body once and return ``{section_name: link_count}``
    for every Notable/Briefly-style section we can announce up front.

    Counting happens before the main transform pass so each link
    section's heading intro can carry the total ("There are eight
    links this week. Link one of eight."). Same line-by-line shape as
    the main loop so the counts match what gets rendered.
    """
    counts: dict[str, int] = {}
    current_section: str | None = None
    for raw_line in body.splitlines():
        line = raw_line.rstrip()
        h2 = re.match(r"^##\s+(.+)$", line)
        if h2:
            current_section = heading_text(h2.group(1))
            counts.setdefault(current_section, 0)
            continue
        if current_section is None:
            continue
        if current_section in LINK_SECTIONS:
            if _H3_LINK_RE.match(line):
                counts[current_section] = counts.get(current_section, 0) + 1
        elif current_section in BRIEFLY_SECTIONS:
            if BRIEFLY_LINK_RE.search(line):
                counts[current_section] = counts.get(current_section, 0) + 1
    return counts


def _link_count_sentence(total: int) -> str:
    """The "There are N links this week." anchor that lands between
    the section intro and the first link. Singular form for 1; spelled-
    out number elsewhere (matches the spelled-out per-link cue)."""
    if total == 1:
        return "There is one link this week."
    return f"There are {number_word(total)} links this week."


def body_to_audio_script(body: str, frontmatter: dict[str, Any]) -> str:
    body = HTML_COMMENT_RE.sub("", body)
    body = STRIKETHROUGH_HTML_RE.sub("", body)
    # Strikethrough that consumed an entire list item leaves an orphan `- `.
    body = re.sub(r"^[ \t]*[-*][ \t]*$", "", body, flags=re.MULTILINE)
    body = FENCED_CODE_RE.sub("", body)
    body = strip_cover_blocks(body)
    body = IMAGE_RE.sub("", body)
    # `[![alt](src)](url)` → `[](url)` after image stripping; drop the empty link.
    body = re.sub(r"\[\s*\]\([^)\n]*\)", "", body)
    # Standalone horizontal rules (cover blocks already removed above).
    body = re.sub(r"^[ \t]*-{3,}[ \t]*$", "", body, flags=re.MULTILINE)
    # Templated "Would you like to discuss..." closing CTA — replaced by audio's own closing.
    body = re.sub(r"^Would you like to discuss[^\n]*$", "", body, flags=re.MULTILINE)
    body = REDDIT_DISCUSS_RE.sub("", body)
    body = SIGNED_BY_RE.sub("", body)

    # Count link/briefly links per section once up front so each section's
    # intro can announce the total ("There are eight links this week.").
    section_link_totals = _count_links_per_section(body)

    output: list[str] = [preamble(frontmatter), ""]
    quote_lines: list[str] = []
    current_section: str | None = None
    current_section_label: str | None = None
    current_section_total: int = 0
    link_index: int = 0
    skip_next_date: bool = False

    def flush_quote() -> None:
        if not quote_lines:
            return
        quote = clean_inline(" ".join(quote_lines))
        quote_lines.clear()
        if quote:
            output.extend(["", "Quote.", quote, "End quote.", ""])

    for raw_line in body.splitlines():
        line = raw_line.rstrip()
        if re.match(r"^\s*>", line):
            quote_lines.append(re.sub(r"^\s*>\s?", "", line).strip())
            continue

        flush_quote()

        if not line.strip():
            if output and output[-1] != "":
                output.append("")
            continue

        h2 = re.match(r"^##\s+(.+)$", line)
        if h2:
            new_section = heading_text(h2.group(1))
            # `## The end 🎬` sign-off — audio's closing line takes its place.
            if new_section.lower().strip() in {"the end", "end", "fin"}:
                if current_section_label:
                    output.extend(["", f"That's the end of {current_section_label}.", ""])
                current_section = None
                current_section_label = None
                link_index = 0
                skip_next_date = False
                continue
            new_label = heading_label(h2.group(1))
            if current_section_label:
                output.extend(["", f"That's the end of {current_section_label}.", ""])
            intro = heading_intro(h2.group(1))
            if intro:
                output.extend(["", intro, ""])
            current_section = new_section
            current_section_label = new_label
            current_section_total = section_link_totals.get(new_section, 0)
            # Anchor the listener: "There are N links this week." sits
            # between the section intro and the first link. Skipped for
            # 0-link sections (the section opener is already enough cue).
            if current_section in LINK_SECTIONS or current_section in BRIEFLY_SECTIONS:
                if current_section_total > 0:
                    output.extend([_link_count_sentence(current_section_total), ""])
            link_index = 0
            skip_next_date = False
            continue

        # Journal date stamps: drop the line; in the micro-entry case the stamp
        # itself acts as the entry boundary and gets a numbered cue.
        if current_section in JOURNAL_SECTIONS and JOURNAL_DATE_RE.match(line):
            if skip_next_date:
                skip_next_date = False
                continue
            link_index += 1
            output.extend([f"Journal entry {number_word(link_index)}.", ""])
            continue

        h3_link = re.match(r"^###\s+\[([^\]]+)]\([^)]+\)\s*$", line)
        if h3_link:
            title = clean_inline(h3_link.group(1))
            if title:
                if current_section in LINK_SECTIONS:
                    link_index += 1
                    output.extend(
                        [
                            f"Link {number_word(link_index)} of "
                            f'{number_word(current_section_total)}. "{title}"',
                            "",
                        ]
                    )
                elif current_section in JOURNAL_SECTIONS:
                    link_index += 1
                    output.extend([f"Journal entry {number_word(link_index)}. {title}", ""])
                    skip_next_date = True
                else:
                    output.extend([title, ""])
            continue

        heading = re.match(r"^#{3,6}\s+(.+)$", line)
        if heading:
            text = clean_inline(heading.group(1))
            if text:
                output.extend([text, ""])
            continue

        # Briefly-style: `<commentary> → **[Title](url)**`. Announce
        # `Link N of TOTAL. "Title"` then read the commentary.
        if current_section in BRIEFLY_SECTIONS:
            briefly_match = BRIEFLY_LINK_RE.search(line)
            if briefly_match:
                title = clean_inline(briefly_match.group(1)).rstrip(" .")
                commentary_raw = line[: briefly_match.start()]
                commentary_raw = re.sub(r"\s*[→][ \t]*$", "", commentary_raw)
                commentary = clean_inline(commentary_raw)
                if title:
                    link_index += 1
                    output.extend(
                        [
                            f"Link {number_word(link_index)} of "
                            f'{number_word(current_section_total)}. "{title}"',
                            "",
                        ]
                    )
                if commentary:
                    output.extend([commentary, ""])
                continue

        text = clean_inline(line)
        if text:
            output.append(text)
            skip_next_date = False

    flush_quote()
    output.extend(["", closing(frontmatter)])
    return finalize_script(output)
