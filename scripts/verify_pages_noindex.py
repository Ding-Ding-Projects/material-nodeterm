#!/usr/bin/env python3
"""Independently verify the composed Pages HTML with Python's HTML parser."""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
from pathlib import Path
import sys
import unittest


CRAWLER_META_NAMES = {"robots", "googlebot", "googlebot-image", "googlebot-news", "bingbot"}
VOID_TAGS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}


class HeadMetadataParser(HTMLParser):
    """Collect effective crawler directives that are direct children of <head>.

    HTMLParser excludes comments and treats script/style bodies as raw text, so
    markup-looking strings in those places are not mistaken for actual elements.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_head = False
        self.head_opened = False
        self.head_closed = False
        self.stack: list[str] = []
        self.directives: list[tuple[str, str | None]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "head" and not self.in_head:
            self.head_opened = True
            self.in_head = True
            self.stack = ["head"]
            return
        if not self.in_head:
            return

        if tag == "meta" and self.stack == ["head"]:
            names = [value for name, value in attrs if name.lower() == "name"]
            if len(names) > 1:
                raise ValueError("meta element has duplicate name attributes")
            name = (names[0] or "").strip().lower() if names else ""
            if name in CRAWLER_META_NAMES:
                contents = [value for attr, value in attrs if attr.lower() == "content"]
                if len(contents) > 1:
                    raise ValueError(f"{name} meta element has duplicate content attributes")
                self.directives.append((name, contents[0] if contents else None))

        if tag not in VOID_TAGS:
            self.stack.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if not self.in_head:
            return
        if tag == "head":
            self.head_closed = True
            self.in_head = False
            self.stack = []
            return
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index] == tag:
                del self.stack[index:]
                break


def parse_head_directives(html: str) -> list[tuple[str, str | None]]:
    parser = HeadMetadataParser()
    parser.feed(html)
    parser.close()
    if not parser.head_opened or not parser.head_closed:
        raise ValueError("HTML has no complete <head> element")
    return parser.directives


def verify_artifact(directory: Path) -> int:
    if not directory.is_dir():
        raise ValueError(f"Pages artifact path is not a directory: {directory}")
    files = sorted(
        file for file in directory.rglob("*")
        if file.is_file() and file.suffix.lower() in {".html", ".htm"}
    )
    if not files:
        raise ValueError(f"No HTML pages found in Pages artifact: {directory}")

    for file in files:
        try:
            directives = parse_head_directives(file.read_text(encoding="utf-8"))
        except Exception as error:
            raise ValueError(f"{file.relative_to(directory)}: {error}") from error

        names = [name for name, _content in directives]
        if names.count("robots") != 1:
            raise ValueError(f"{file.relative_to(directory)} has {names.count('robots')} robots directives in <head>")
        for name, content in directives:
            if (content or "").strip().lower() != "noindex":
                raise ValueError(f"{file.relative_to(directory)} has {name} content other than noindex")

    return len(files)


class ParserTests(unittest.TestCase):
    def test_comment_does_not_count_as_metadata(self):
        html = '<html><head><!-- <meta name="robots" content="index"> --></head></html>'
        self.assertEqual(parse_head_directives(html), [])

    def test_script_string_does_not_count_as_metadata(self):
        html = '<html><head><script>const fake = \'<meta name="robots" content="index">\';</script></head></html>'
        self.assertEqual(parse_head_directives(html), [])

    def test_unquoted_attribute_values_are_parsed(self):
        html = '<html><head><meta name=robots content=noindex></head></html>'
        self.assertEqual(parse_head_directives(html), [("robots", "noindex")])

    def test_meta_outside_head_is_not_effective(self):
        html = '<html><head></head><body><meta name=robots content=index></body></html>'
        self.assertEqual(parse_head_directives(html), [])


def main() -> int:
    if "--self-test" in sys.argv:
        sys.argv.remove("--self-test")
        unittest.main(module=__name__, argv=[sys.argv[0]])
        return 0

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path, help="composed Pages artifact directory")
    args = parser.parse_args()
    count = verify_artifact(args.artifact)
    print(f"HTMLParser-verified noindex on all {count} Pages HTML file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
