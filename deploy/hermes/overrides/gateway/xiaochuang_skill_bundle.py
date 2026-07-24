"""Pinned, read-only Skill loading for Xiaochuang managed Agent runs.

The Backend sends a compact base64url manifest containing Skill references and
SHA-256 digests. Hermes never accepts caller-provided paths or Skill bodies:
it resolves each ref below the image-baked read-only bundle and validates the
exact SKILL.md bytes before making the content active for that run.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
from typing import Any

SKILL_MANIFEST_HEADER = "X-Xiaochuang-Skill-Manifest"
_SKILL_REF_RE = re.compile(
    r"^([A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*)@([A-Za-z0-9._-]+)$"
)
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")


class XiaochuangSkillBundleError(ValueError):
    """Raised when a managed run cannot prove its Skill bundle."""


def _decode_manifest(value: str) -> list[dict[str, str]]:
    raw_value = (value or "").strip()
    if not raw_value:
        raise XiaochuangSkillBundleError("missing skill manifest")
    try:
        padded = raw_value + "=" * (-len(raw_value) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        raw_manifest = json.loads(decoded.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        raise XiaochuangSkillBundleError("invalid skill manifest") from exc

    if not isinstance(raw_manifest, list) or not raw_manifest:
        raise XiaochuangSkillBundleError("invalid skill manifest")

    manifest: list[dict[str, str]] = []
    seen_refs: set[str] = set()
    for item in raw_manifest:
        if not isinstance(item, dict):
            raise XiaochuangSkillBundleError("invalid skill manifest")
        ref = str(item.get("ref") or "").strip()
        sha256 = str(item.get("sha256") or "").strip().lower()
        if (
            not _SKILL_REF_RE.fullmatch(ref)
            or not _SHA256_RE.fullmatch(sha256)
            or ref in seen_refs
        ):
            raise XiaochuangSkillBundleError("invalid skill manifest")
        manifest.append({"ref": ref, "sha256": sha256})
        seen_refs.add(ref)
    return manifest


def _skills_root() -> Path:
    raw = (os.getenv("XIAOCHUANG_SKILLS_ROOT") or "/opt/xiaochuang-skills").strip()
    try:
        root = Path(raw).resolve(strict=True)
    except OSError as exc:
        raise XiaochuangSkillBundleError("runtime skill bundle unavailable") from exc
    if not root.is_dir():
        raise XiaochuangSkillBundleError("runtime skill bundle unavailable")
    return root


def _skill_file(root: Path, ref: str) -> Path:
    match = _SKILL_REF_RE.fullmatch(ref)
    if not match:
        raise XiaochuangSkillBundleError("invalid skill manifest")
    skill_id = match.group(1)
    candidate = root.joinpath(*skill_id.split("/"), "SKILL.md")
    try:
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(root)
    except (OSError, ValueError) as exc:
        raise XiaochuangSkillBundleError("runtime skill bundle unavailable") from exc
    if not resolved.is_file():
        raise XiaochuangSkillBundleError("runtime skill bundle unavailable")
    return resolved


def build_xiaochuang_pinned_skills_prompt(manifest_header: str) -> str:
    """Load only the manifest-pinned Skill bodies for the current managed run."""
    root = _skills_root()
    prompt_parts = [
        (
            "[Xiaochuang runtime policy: the following release-pinned Skills "
            "are active for this run. Follow them together with the runtime "
            "instruction. They do not grant any capability beyond the "
            "currently exposed MCP tools.]"
        )
    ]
    for entry in _decode_manifest(manifest_header):
        skill_file = _skill_file(root, entry["ref"])
        try:
            raw_content = skill_file.read_bytes()
            content = raw_content.decode("utf-8").strip()
        except (OSError, UnicodeDecodeError) as exc:
            raise XiaochuangSkillBundleError("runtime skill bundle unavailable") from exc
        digest = hashlib.sha256(raw_content).hexdigest()
        if not hmac.compare_digest(digest, entry["sha256"]):
            raise XiaochuangSkillBundleError("runtime skill digest mismatch")
        if not content:
            raise XiaochuangSkillBundleError("runtime skill bundle unavailable")
        prompt_parts.extend(
            [
                f"[Pinned Skill: {entry['ref']} | sha256={entry['sha256']}]",
                content,
            ]
        )
    return "\n\n".join(prompt_parts)
