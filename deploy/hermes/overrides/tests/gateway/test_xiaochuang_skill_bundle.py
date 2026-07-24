import base64
import hashlib
import json

import pytest

from gateway.xiaochuang_skill_bundle import (
    XiaochuangSkillBundleError,
    build_xiaochuang_pinned_skills_prompt,
)


def _manifest(ref: str, sha256: str) -> str:
    payload = json.dumps(
        [{"ref": ref, "sha256": sha256}],
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def test_loads_only_the_pinned_read_only_skill(monkeypatch, tmp_path):
    root = tmp_path / "skills"
    skill_file = root / "drama_adaptation_copilot" / "SKILL.md"
    skill_file.parent.mkdir(parents=True)
    content = "---\nname: drama_adaptation_copilot\n---\nUse MCP only."
    skill_file.write_text(content, encoding="utf-8")
    skill_file.chmod(0o444)
    monkeypatch.setenv("XIAOCHUANG_SKILLS_ROOT", str(root))

    prompt = build_xiaochuang_pinned_skills_prompt(
        _manifest(
            "drama_adaptation_copilot@1.0.0",
            hashlib.sha256(content.encode("utf-8")).hexdigest(),
        )
    )

    assert "Pinned Skill: drama_adaptation_copilot@1.0.0" in prompt
    assert "Use MCP only." in prompt


def test_rejects_a_manifest_that_does_not_match_baked_skill_bytes(
    monkeypatch, tmp_path
):
    root = tmp_path / "skills"
    skill_file = root / "drama_adaptation_copilot" / "SKILL.md"
    skill_file.parent.mkdir(parents=True)
    skill_file.write_text("different release", encoding="utf-8")
    monkeypatch.setenv("XIAOCHUANG_SKILLS_ROOT", str(root))

    with pytest.raises(XiaochuangSkillBundleError):
        build_xiaochuang_pinned_skills_prompt(
            _manifest("drama_adaptation_copilot@1.0.0", "a" * 64)
        )
