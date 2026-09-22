"""Historical Tinyletter/MailChimp audio script transform (#1-130).

Handles the post-migration body shape for older issues:

- Emoji-suffix headings ``## Featured 🏅``, ``## Notable Links 📌``,
  ``## Yet More Links 🍞``, ``## Breadcrumbs 🍞``, ``## Blog posts 📬``
  — heading-text normalization strips trailing emoji and the section
  vocabulary maps every known historical variant to a spoken cue.
- ``## by Name`` subtitle H2s used under MailChimp-era Featured Apps —
  these don't open a section; the line falls through as plain text.
- The wide variety of MailChimp section names (Coffee, Culture, Food,
  Health, etc.) — handled via the default "Now, the X section." intro.

Frozen as the historical archive is frozen. Future issues route to
``modern.py`` and never enter this module.
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

# Section vocabulary — canonical names plus every legacy variant we've seen.
HEADING_INTROS = {
    "Featured": "Now, the Featured section.",
    "Featured Links": "Now, the Featured Links section.",
    "Notable": "Now, the Notable section.",
    "Notable Links": "Now, the Notable Links section.",
    "Links": "Now, the Links section.",
    "Must Read": "Now, the Must Read section.",
    "Briefly": "Now, the Briefly section.",
    "Recommended Links": "Now, the Recommended Links section.",
    "FYI": "Now, for your information.",
    "Yet More Links": "Now, more links.",
    "Journal": "Now, the Journal section.",
}

HEADING_LABELS = {
    "Featured": "Featured",
    "Featured Links": "Featured Links",
    "Notable": "Notable",
    "Notable Links": "Notable Links",
    "Links": "Links",
    "Must Read": "Must Read",
    "Briefly": "Briefly",
    "Recommended Links": "Recommended Links",
    "FYI": "the FYI section",
    "Yet More Links": "More Links",
    "Journal": "the Journal",
}

# H3 entries are individual links worth signposting.
LINK_SECTIONS = {
    "Featured",
    "Featured Links",
    "Notable",
    "Notable Links",
    "Links",
    "Must Read",
}

# Sections whose paragraphs use `<commentary> → **[title](url)**`.
BRIEFLY_SECTIONS = {
    "Briefly",
    "Recommended Links",
    "FYI",
    "Yet More Links",
}

JOURNAL_SECTIONS = {"Journal"}


def heading_intro(raw: str) -> str:
    text = heading_text(raw)
    return HEADING_INTROS.get(text, f"Now, the {text} section.")


def heading_label(raw: str) -> str:
    text = heading_text(raw)
    return HEADING_LABELS.get(text, text)


def body_to_audio_script(body: str, frontmatter: dict[str, Any]) -> str:
    body = HTML_COMMENT_RE.sub("", body)
    body = STRIKETHROUGH_HTML_RE.sub("", body)
    body = re.sub(r"^[ \t]*[-*][ \t]*$", "", body, flags=re.MULTILINE)
    body = FENCED_CODE_RE.sub("", body)
    body = strip_cover_blocks(body)
    body = IMAGE_RE.sub("", body)
    body = re.sub(r"\[\s*\]\([^)\n]*\)", "", body)
    body = re.sub(r"^[ \t]*-{3,}[ \t]*$", "", body, flags=re.MULTILINE)

    output: list[str] = [preamble(frontmatter), ""]
    quote_lines: list[str] = []
    current_section: str | None = None
    current_section_label: str | None = None
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
            if new_section.lower().strip() in {"the end", "end", "fin"}:
                if current_section_label:
                    output.extend(["", f"That's the end of {current_section_label}.", ""])
                current_section = None
                current_section_label = None
                link_index = 0
                skip_next_date = False
                continue
            # Subtitle/byline disguised as H2 (e.g. `## by kunabi brother GmbH`
            # under a Featured App in early MailChimp issues). Don't open or
            # close a section — let it fall through as a plain text line.
            if re.match(r"^by\s+", new_section, re.IGNORECASE):
                cleaned_text = clean_inline(h2.group(1))
                if cleaned_text:
                    output.extend([cleaned_text, ""])
                continue
            new_label = heading_label(h2.group(1))
            if current_section_label:
                output.extend(["", f"That's the end of {current_section_label}.", ""])
            intro = heading_intro(h2.group(1))
            if intro:
                output.extend(["", intro, ""])
            current_section = new_section
            current_section_label = new_label
            link_index = 0
            skip_next_date = False
            continue

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
                    output.extend([f'Link {number_word(link_index)}. "{title}"', ""])
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

        if current_section in BRIEFLY_SECTIONS:
            briefly_match = BRIEFLY_LINK_RE.search(line)
            if briefly_match:
                title = clean_inline(briefly_match.group(1)).rstrip(" .")
                commentary_raw = line[: briefly_match.start()]
                commentary_raw = re.sub(r"\s*[→][ \t]*$", "", commentary_raw)
                commentary = clean_inline(commentary_raw)
                if title:
                    link_index += 1
                    output.extend([f'Link {number_word(link_index)}. "{title}"', ""])
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
