"""Translation of user-facing API text.

The backend keeps producing Spanish. Responses to clients that ask for another
language (``X-MyDGX-Language`` or ``Accept-Language``) are translated on the
way out: exact catalog entries first, then f-string templates whose numbered
placeholders ({0}, {1}, ...) capture the interpolated values.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

SUPPORTED_LANGUAGES = {"es", "en"}
DEFAULT_LANGUAGE = "es"
LOCALES_DIR = Path(__file__).with_name("locales")

# Values under these keys are identifiers or enums the dashboard compares,
# so they must reach the client unchanged.
UNTRANSLATED_KEYS = frozenset({
    "id", "key", "kind", "status", "state", "recommendation_status", "type", "role",
    "path", "paths", "url", "file", "filename", "model", "model_id", "model_repo", "repo", "engine",
    "task", "command", "quantization", "architecture", "hash", "artifact_hash", "token", "content",
    "messages", "prompt", "system_prompt", "response", "output", "text", "stdout", "stderr", "lines",
    "entries", "logs", "log", "target", "detail_json", "config", "env", "confirm",
})
# Profile editors send these fields back unchanged, so translating them would
# persist the translation.
USER_DATA_ROUTE_PREFIXES = ("/api/profiles",)
USER_DATA_KEYS = frozenset({"name", "alias", "model_alias", "model_ref", "description"})
PLACEHOLDER = re.compile(r"\{(\d+)\}")
TEMPLATE_MIN_LITERAL_SHARE = 0.4


def request_language(headers: Any, default: str = DEFAULT_LANGUAGE) -> str:
    explicit = (headers.get("x-mydgx-language") or "").strip().lower()
    if explicit in SUPPORTED_LANGUAGES:
        return explicit
    for part in (headers.get("accept-language") or "").split(","):
        base = part.split(";")[0].strip().lower().split("-")[0]
        if base in SUPPORTED_LANGUAGES:
            return base
    return default


class Catalog:
    def __init__(self, entries: dict[str, str]) -> None:
        self.exact: dict[str, str] = {}
        self.templates: list[tuple[re.Pattern[str], str, int]] = []
        for source, target in entries.items():
            if not target:
                continue
            if PLACEHOLDER.search(source):
                literal_length = len(PLACEHOLDER.sub("", source).replace("{{", "{").replace("}}", "}"))
                self.templates.append((self._compile(source), target, literal_length))
            else:
                self.exact[source.replace("{{", "{").replace("}}", "}")] = target
        self.templates.sort(key=lambda item: -item[2])

    @staticmethod
    def _plausible(text: str, literal_length: int, values: Any) -> bool:
        """Short templates such as "Modelo {0}" must not swallow whole sentences or user text."""
        return literal_length >= TEMPLATE_MIN_LITERAL_SHARE * len(text) or not any(
            any(character.isspace() for character in value) for value in values
        )

    @staticmethod
    def _compile(source: str) -> re.Pattern[str]:
        pattern, position = [], 0
        for match in PLACEHOLDER.finditer(source):
            literal = source[position:match.start()].replace("{{", "{").replace("}}", "}")
            pattern.append(re.escape(literal))
            pattern.append(f"(?P<p{match.group(1)}>.*?)")
            position = match.end()
        pattern.append(re.escape(source[position:].replace("{{", "{").replace("}}", "}")))
        return re.compile("".join(pattern), re.DOTALL)

    def translate(self, text: str) -> str:
        if not text or len(text) > 4000:
            return text
        exact = self.exact.get(text)
        if exact is not None:
            return exact
        for pattern, target, literal_length in self.templates:
            match = pattern.fullmatch(text)
            if match and self._plausible(text, literal_length, match.groupdict().values()):
                values = {name[1:]: self.translate(value) for name, value in match.groupdict().items()}
                parts = re.split(r"(\{\{|\}\}|\{\d+\})", target)
                return "".join(
                    "{" if part == "{{" else "}" if part == "}}"
                    else values.get(part[1:-1], "") if PLACEHOLDER.fullmatch(part) else part
                    for part in parts
                )
        head, separator, tail = text.partition(": ")
        if separator and head in self.exact:
            return f"{self.exact[head]}: {self.translate(tail)}"
        # Summaries join catalog entries with " · "; each piece is translated on its own.
        if " · " in text:
            parts = text.split(" · ")
            translated = [self.translate(part) for part in parts]
            if translated != parts:
                return " · ".join(translated)
        return text


@lru_cache(maxsize=None)
def catalog(language: str) -> Catalog | None:
    if language == DEFAULT_LANGUAGE:
        return None
    path = LOCALES_DIR / f"{language}.json"
    if not path.exists():
        return None
    return Catalog(json.loads(path.read_text(encoding="utf-8")))


def translate_text(text: str, language: str) -> str:
    current = catalog(language)
    return current.translate(text) if current else text


def translate_payload(value: Any, language: str, path: str = "") -> Any:
    current = catalog(language)
    if current is None:
        return value
    protected = UNTRANSLATED_KEYS | USER_DATA_KEYS if path.startswith(USER_DATA_ROUTE_PREFIXES) else UNTRANSLATED_KEYS
    return _translate(value, current, protected)


def _translate(value: Any, current: Catalog, protected: frozenset[str]) -> Any:
    if isinstance(value, str):
        return current.translate(value)
    if isinstance(value, list):
        return [_translate(item, current, protected) for item in value]
    if isinstance(value, dict):
        return {
            key: item if key in protected else _translate(item, current, protected)
            for key, item in value.items()
        }
    return value
