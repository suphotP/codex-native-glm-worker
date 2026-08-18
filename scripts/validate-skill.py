#!/usr/bin/env python3
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parent.parent
skill = root / "skill" / "codex-native-glm-worker" / "SKILL.md"
metadata = root / "skill" / "codex-native-glm-worker" / "agents" / "openai.yaml"

errors: list[str] = []
source = skill.read_text()
if not source.startswith("---\n") or "\n---\n" not in source[4:]:
    errors.append("SKILL.md frontmatter is missing")
else:
    frontmatter = source.split("---\n", 2)[1]
    keys = [line.split(":", 1)[0] for line in frontmatter.splitlines() if ":" in line]
    if keys != ["name", "description"]:
        errors.append(f"SKILL.md frontmatter keys are not exact: {keys}")
    if "name: codex-native-glm-worker" not in frontmatter:
        errors.append("skill name is invalid")
    description = next((line.split(":", 1)[1].strip() for line in frontmatter.splitlines() if line.startswith("description:")), "")
    if len(description) < 80:
        errors.append("skill description is too short to trigger reliably")

if len(source.splitlines()) >= 500:
    errors.append("SKILL.md must remain under 500 lines")
if "TODO" in source:
    errors.append("SKILL.md still contains TODO")
for relative in re.findall(r"\]\((references/[^)]+)\)", source):
    if not (skill.parent / relative).is_file():
        errors.append(f"missing skill reference: {relative}")

metadata_source = metadata.read_text()
for required in (
    'display_name: "Native GLM Worker"',
    'short_description: "Install and verify native GLM Codex workers"',
    '$codex-native-glm-worker',
):
    if required not in metadata_source:
        errors.append(f"openai.yaml missing {required}")

if errors:
    for error in errors:
        print(f"SKILL_INVALID: {error}", file=sys.stderr)
    raise SystemExit(1)
print("SKILL_VALID")
