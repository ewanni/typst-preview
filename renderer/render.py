# /// script
# requires-python = ">=3.11"
# dependencies = ["typst==0.15.0", "pillow>=11"]
# ///
"""Render one page of a Typst document for the Typst Preview pane.

The desktop pane draws pictures only through `Svg` elements of at most 131072
characters each. A page whose vector SVG fits is sent as is; otherwise the
page is rasterised, palette-quantised and cut into horizontal strips, each
wrapped in its own small SVG, which the pane stacks without gaps.

Prints one JSON object: ok, page, page_count, kind (svg | raster), parts,
errors, warnings (diagnostics with file/line/column/hints) and mtime_ms.

Usage: uv run --script render.py <file.typ> [--page N] [--max-chars N]
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sys

import typst
from PIL import Image

# Below the pane's 131072-character limit, leaving room for the wrapper markup.
MAX_PART_CHARS = 120_000
RASTER_PPI = 110
PALETTE_COLORS = 64

_HEADER_RE = re.compile(r"^(error|warning): (.*)$", re.M)
_LOCATION_RE = re.compile(r"┌─ (.+?):(\d+):(\d+)")
_HINT_RE = re.compile(r"^\s*= hint: (.*)$", re.M)
# Name typst-py gives sources passed as bytes.
_IN_MEMORY_FILE = "__typst_py_bytes__.typ"


def diagnostics(rendered: str, severity: str) -> list[dict]:
    """Split Typst's rendered diagnostics into dicts."""
    matches = list(_HEADER_RE.finditer(rendered or ""))
    if not matches:
        text = (rendered or "").strip()
        return [_diag(severity, text, text)] if text else []
    out = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(rendered)
        block = rendered[m.start() : end].strip()
        d = _diag(m.group(1), m.group(2).strip(), block)
        if loc := _LOCATION_RE.search(block):
            name = loc.group(1).strip()
            d["file"] = "<source>" if name == _IN_MEMORY_FILE else name
            d["line"], d["column"] = int(loc.group(2)), int(loc.group(3))
        d["hints"] = [h.strip() for h in _HINT_RE.findall(block)]
        out.append(d)
    return out


def _diag(severity: str, message: str, rendered: str) -> dict:
    return {
        "severity": severity,
        "message": message,
        "file": None,
        "line": None,
        "column": None,
        "hints": [],
        "rendered": rendered,
    }


def _pages(compiler: typst.Compiler, fmt: str, **kwargs) -> tuple[list[bytes], list[dict]]:
    data, warnings = compiler.compile_with_warnings(format=fmt, **kwargs)
    pages = [data] if isinstance(data, (bytes, bytearray)) else list(data or [])
    found = [d for w in warnings for d in diagnostics(w.diagnostic or w.message, "warning")]
    return [bytes(p) for p in pages], found


def _strip_svg(png: bytes, width: int, height: int, scale: float) -> str:
    data = base64.b64encode(png).decode("ascii")
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width * scale:.2f}" '
        f'height="{height * scale:.2f}" viewBox="0 0 {width} {height}">'
        f'<image width="{width}" height="{height}" href="data:image/png;base64,{data}"/></svg>'
    )


def raster_parts(png: bytes, max_chars: int = MAX_PART_CHARS, ppi: float = RASTER_PPI) -> list[str]:
    """Cut a rendered page into strips whose wrapping SVG fits ``max_chars``.

    Strips are sized in CSS pixels at 96 dpi so the stack keeps the page's size.
    """
    image = Image.open(io.BytesIO(png)).convert("RGB").quantize(PALETTE_COLORS)
    width, height = image.size
    parts: list[str] = []
    top, strip = 0, height
    while top < height:
        bottom = min(height, top + strip)
        buffer = io.BytesIO()
        image.crop((0, top, width, bottom)).save(buffer, format="PNG", optimize=True)
        svg = _strip_svg(buffer.getvalue(), width, bottom - top, 96 / ppi)
        if len(svg) > max_chars and strip > 8:
            strip = max(8, strip // 2)
            continue
        parts.append(svg)
        top = bottom
    return parts


def render(path: str, page: int, max_chars: int = MAX_PART_CHARS) -> dict:
    result = {
        "ok": False,
        "file": path,
        "page": page,
        "page_count": 0,
        "kind": "svg",
        "parts": [],
        "errors": [],
        "warnings": [],
        "mtime_ms": None,
    }
    try:
        result["mtime_ms"] = int(os.stat(path).st_mtime * 1000)
        compiler = typst.Compiler(path)
        svgs, result["warnings"] = _pages(compiler, "svg")
    except OSError as exc:
        result["errors"] = [_diag("error", str(exc), str(exc))]
        return result
    except typst.TypstError as exc:
        result["errors"] = diagnostics(exc.diagnostic or exc.message, "error") or [
            _diag("error", exc.message, exc.message)
        ]
        return result

    result["page_count"] = len(svgs)
    result["ok"] = True
    if not svgs:
        return result
    page = min(max(page, 1), len(svgs))
    result["page"] = page
    svg = svgs[page - 1].decode("utf-8")
    if len(svg) <= max_chars:
        result["parts"] = [svg]
    else:
        pngs, _ = _pages(compiler, "png", ppi=RASTER_PPI)
        result["kind"] = "raster"
        result["parts"] = raster_parts(pngs[page - 1], max_chars)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="render.py")
    parser.add_argument("path")
    parser.add_argument("--page", type=int, default=1)
    parser.add_argument("--max-chars", type=int, default=MAX_PART_CHARS)
    args = parser.parse_args(argv)
    json.dump(render(args.path, args.page, args.max_chars), sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
