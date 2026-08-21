#!/usr/bin/env python3
"""Generate the README flow diagram in light and dark variants.

GitHub strips <style> blocks from inline SVG, so everything here uses
presentation attributes only. Two files rather than one media-query file,
paired with <picture> in the README, which is how GitHub does theming.
"""

from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "docs"

W, H = 900, 300

SANS = "-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif"
MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

THEMES = {
    "light": {
        "text": "#1f2328",
        "muted": "#59636e",
        "faint": "#818b98",
        "border": "#d1d9e0",
        "panel": "#ffffff",
        "accent": "#0969da",
        "green": "#1a7f37",
    },
    "dark": {
        "text": "#e6edf3",
        "muted": "#9198a1",
        "faint": "#656c76",
        "border": "#3d444d",
        "panel": "#151b23",
        "accent": "#4493f8",
        "green": "#3fb950",
    },
}

FEEDBACK = [
    "Bottom tab bar disappears",
    "Can't like a comment",
    "Photo is cropped when shared",
    "Crash on notification tap",
]

# SVG text collapses leading whitespace, so indentation is an x offset.
OUTPUT = [
    ("testflight/TASKS.md", "muted", 0),
    ("tasks/TF-ALc8ZZJ8FS.md", "faint", 16),
    ("screenshots/TF-ALc8ZZJ8FS.jpg", "faint", 16),
    ("crashes/TF-AAjYVBLoUC.crash", "faint", 16),
    (".claude/commands/hangar.md", "muted", 0),
]


def esc(value):
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def render(theme):
    c = THEMES[theme]
    p = []

    def text(x, y, value, size=13, color="text", family=SANS, weight="400", anchor="start"):
        p.append(
            f'<text x="{x}" y="{y}" font-family="{family}" font-size="{size}" '
            f'font-weight="{weight}" fill="{c[color]}" text-anchor="{anchor}">{esc(value)}</text>'
        )

    def panel(x, y, w, h):
        p.append(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="10" '
            f'fill="{c["panel"]}" stroke="{c["border"]}" stroke-width="1"/>'
        )

    # --- left: the feedback you are looking at -----------------------------
    panel(1, 52, 360, 200)
    text(21, 40, "App Store Connect", 11, "faint", weight="600")

    for index, line in enumerate(FEEDBACK):
        y = 84 + index * 40
        # A ticked selection box.
        p.append(
            f'<rect x="21" y="{y - 12}" width="16" height="16" rx="4" '
            f'fill="{c["accent"]}"/>'
        )
        p.append(
            f'<path d="M25 {y - 4.5} l3 3 l5.5 -6" fill="none" stroke="#ffffff" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        )
        text(49, y + 1, line, 13, "text")

    # --- middle: the tool --------------------------------------------------
    p.append(
        f'<path d="M382 152 H502" stroke="{c["border"]}" stroke-width="2" '
        f'stroke-linecap="round"/>'
    )
    p.append(
        f'<path d="M494 145 l8 7 l-8 7" fill="none" stroke="{c["border"]}" '
        f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
    )
    text(442, 138, "Hangar", 13, "accent", weight="700", anchor="middle")
    text(442, 182, "select · export", 11, "faint", anchor="middle")

    # --- right: what lands in the repository -------------------------------
    panel(539, 52, 360, 200)
    text(559, 40, "Your repository", 11, "faint", weight="600")

    for index, (line, color, indent) in enumerate(OUTPUT):
        text(559 + indent, 84 + index * 30, line, 12.5, color, family=MONO)

    # --- caption -----------------------------------------------------------
    text(
        450,
        286,
        "tester's words · screenshot · crash log · device conditions",
        12,
        "muted",
        anchor="middle",
    )

    body = "\n  ".join(p)

    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'width="{W}" height="{H}" role="img" '
        f'aria-label="Selected TestFlight feedback becomes a task pack in your repository">\n'
        f"  {body}\n</svg>\n"
    )


def main():
    OUT.mkdir(exist_ok=True)

    for theme in THEMES:
        path = OUT / f"flow-{theme}.svg"
        path.write_text(render(theme))
        print(f"{path.relative_to(OUT.parent)}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
