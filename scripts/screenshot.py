#!/usr/bin/env python3
"""Render a tmux pane capture (with colours) to a PNG for the README.

Usage:
  tmux capture-pane -e -p -t <session> | python3 scripts/screenshot.py docs/screenshot.png [--title "text"] [--cols 160]

Needs chromium (headless) and ImageMagick's convert on PATH. The capture is ANSI text;
this script turns the SGR codes into styled HTML spans, frames it like a terminal window
and screenshots it, so the image is the real drawing, not a mock.
"""
from __future__ import annotations

import html
import re
import subprocess
import sys
import tempfile
from pathlib import Path

PALETTE = {
    30: '#3b3b3b', 31: '#f38ba8', 32: '#a6e3a1', 33: '#f9e2af', 34: '#89b4fa', 35: '#cba6f7', 36: '#94e2d5', 37: '#cdd6f4',
    90: '#6c7086', 91: '#f38ba8', 92: '#a6e3a1', 93: '#f9e2af', 94: '#89b4fa', 95: '#cba6f7', 96: '#94e2d5', 97: '#ffffff',
}
FG_DEFAULT, BG_DEFAULT = '#cdd6f4', '#181825'
SGR = re.compile(r'\x1b\[([0-9;]*)m')
# Everything that is not a colour/style code is dropped: OSC (hyperlinks, titles), other CSI, single-char escapes.
NOISE = re.compile(r'\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-LN-Za-ln-z]|\x1b[^\[\]]')


def colour_256(n: int) -> str:
    if n < 16:
        return PALETTE[(30 + n) if n < 8 else (90 + n - 8)]
    if n < 232:
        n -= 16
        r, g, b = n // 36, (n // 6) % 6, n % 6
        step = [0, 95, 135, 175, 215, 255]
        return f'#{step[r]:02x}{step[g]:02x}{step[b]:02x}'
    v = 8 + (n - 232) * 10
    return f'#{v:02x}{v:02x}{v:02x}'


def spans_of(line: str, cols: int) -> str:
    """One captured line to HTML: SGR codes become spans, the rest is escaped text."""
    style = {'fg': None, 'bg': None, 'bold': False, 'dim': False, 'italic': False, 'inverse': False}
    out, pos, text_cols = [], 0, 0

    def flush(text: str) -> None:
        nonlocal text_cols
        if not text:
            return
        text_cols += len(text)
        fg, bg = style['fg'] or FG_DEFAULT, style['bg'] or BG_DEFAULT
        if style['inverse']:
            fg, bg = bg, fg
        css = [f'color:{fg}']
        if style['bg'] or style['inverse']:
            css.append(f'background:{bg}')
        if style['bold']:
            css.append('font-weight:700')
        if style['dim']:
            css.append('opacity:.55')
        if style['italic']:
            css.append('font-style:italic')
        out.append(f'<span style="{";".join(css)}">{html.escape(text)}</span>')

    for m in SGR.finditer(line):
        flush(line[pos:m.start()])
        pos = m.end()
        codes = [int(c) for c in m.group(1).split(';') if c != ''] or [0]
        i = 0
        while i < len(codes):
            c = codes[i]
            if c == 0:
                style.update(fg=None, bg=None, bold=False, dim=False, italic=False, inverse=False)
            elif c == 1:
                style['bold'] = True
            elif c == 2:
                style['dim'] = True
            elif c == 3:
                style['italic'] = True
            elif c == 7:
                style['inverse'] = True
            elif c == 22:
                style['bold'] = style['dim'] = False
            elif c == 23:
                style['italic'] = False
            elif c == 27:
                style['inverse'] = False
            elif c == 39:
                style['fg'] = None
            elif c == 49:
                style['bg'] = None
            elif 30 <= c <= 37 or 90 <= c <= 97:
                style['fg'] = PALETTE[c]
            elif 40 <= c <= 47 or 100 <= c <= 107:
                style['bg'] = PALETTE[c - 10]
            elif c in (38, 48) and i + 1 < len(codes):
                key = 'fg' if c == 38 else 'bg'
                if codes[i + 1] == 5 and i + 2 < len(codes):
                    style[key] = colour_256(codes[i + 2])
                    i += 2
                elif codes[i + 1] == 2 and i + 4 < len(codes):
                    style[key] = f'#{codes[i + 2]:02x}{codes[i + 3]:02x}{codes[i + 4]:02x}'
                    i += 4
            i += 1
    flush(line[pos:])
    if text_cols < cols:
        out.append(' ' * (cols - text_cols))
    return ''.join(out)


def page(lines: list[str], cols: int, title: str) -> str:
    body = '\n'.join(spans_of(line, cols) for line in lines)
    return f'''<!doctype html><meta charset="utf-8">
<style>
  html,body{{margin:0;background:transparent}}
  .win{{display:inline-block;background:{BG_DEFAULT};border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.45);padding:0 0 14px;margin:28px}}
  .bar{{height:38px;display:flex;align-items:center;gap:8px;padding:0 14px;color:#6c7086;font:13px -apple-system,Segoe UI,sans-serif}}
  .dot{{width:12px;height:12px;border-radius:50%}}
  .t{{flex:1;text-align:center;margin-right:52px}}
  /* FreeMono is the only installed monospace covering the transcript elbow U+23BF: without it that row
     falls back to a proportional font, shifts by about a cell, and the card borders look doubled. */
  pre{{margin:0;padding:6px 18px 0;font:14px/1.3 "DejaVu Sans Mono","FreeMono","Noto Sans Mono",monospace;color:{FG_DEFAULT};white-space:pre}}
</style>
<div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span><span class="t">{html.escape(title)}</span></div><pre>{body}</pre></div>'''


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    out = Path(args[0])
    title = args[args.index('--title') + 1] if '--title' in args else 'ContextSaver'
    cols = int(args[args.index('--cols') + 1]) if '--cols' in args else 160
    home = str(Path.home())
    text = NOISE.sub('', sys.stdin.read()).replace(home, '~')   # no private paths in a public screenshot
    lines = text.split('\n')
    while lines and lines[-1].strip() == '':
        lines.pop()
    cache = Path.home() / 'tmp' / 'contextsaver-screenshot'   # snap chromium sees neither /tmp nor hidden dirs in $HOME
    cache.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=cache) as tmp:
        src = Path(tmp) / 'shot.html'
        src.write_text(page(lines, cols, title), encoding='utf-8')
        raw = Path(tmp) / 'raw.png'
        width, height = cols * 9 + 120, len(lines) * 19 + 140
        chromium = next(c for c in ('chromium', 'chromium-browser', 'google-chrome') if subprocess.run(['which', c], capture_output=True).returncode == 0)
        subprocess.run([chromium, '--headless=new', '--hide-scrollbars', '--default-background-color=00000000', f'--window-size={width},{height}', f'--screenshot={raw}', src.as_uri()], check=True, capture_output=True)
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['convert', str(raw), '-trim', '+repage', '-bordercolor', 'none', '-border', '24', str(out)], check=True)
    print(out)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
