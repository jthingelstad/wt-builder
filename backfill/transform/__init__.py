"""Audio script transform — public API and era-based dispatcher.

Given a Buttondown body and frontmatter, produces a TTS-ready spoken script.
Routes to the appropriate era-specific transformer based on issue number:

- Issues #1-130 (Tinyletter + MailChimp eras, post-migration) → ``legacy.py``
- Issues #131+ (Buttondown era, going forward) → ``modern.py``

The boundary is empirical: emoji-suffix H2 headings (``## Featured 🏅``,
``## Yet More Links 🍞``) appear in #1 through #130 and stop cleanly at #131,
which is the first issue published natively on Buttondown with canonical
section names.
"""

from __future__ import annotations

import re
from typing import Any

LEGACY_MAX_ISSUE = 130


def _issue_number(frontmatter: dict[str, Any]) -> int:
    """Extract the leading integer from a frontmatter number, tolerating
    suffixed special editions like ``140-special``."""
    raw = str(frontmatter.get("number") or "").strip()
    match = re.match(r"\d+", raw)
    return int(match.group(0)) if match else 0


def body_to_audio_script(body: str, frontmatter: dict[str, Any]) -> str:
    """Render a TTS-ready audio script from an archive body + frontmatter."""
    if _issue_number(frontmatter) <= LEGACY_MAX_ISSUE:
        from . import legacy

        return legacy.body_to_audio_script(body, frontmatter)
    from . import modern

    return modern.body_to_audio_script(body, frontmatter)


__all__ = ["body_to_audio_script", "LEGACY_MAX_ISSUE"]
