"""Offline T02 documentation/configuration contract checks; no dependencies or secret output."""
from pathlib import Path
import json
import re
import hashlib

ROOT = Path(__file__).resolve().parents[4]
PHASE = ROOT / "docs/ai-agent-platform/phase-6"
DOCUMENTS = [PHASE / name for name in (
    "README.md", "implementation-plan.md", "configuration-contracts.md",
    "configuration-inventory.md", "t02-verification.md",
    "principal-authorization.md", "t03-verification.md", "authentication-modes.md", "decisions.md", "frontend-access.md", "container-hardening.md", "edge-network.md", "database-migrations.md", "backup-recovery.md", "runtime-drain.md", "external-connectivity.md", "observability.md", "email-monitoring.md", "immutable-promotion.md", "staging-uat.md", "security-capacity-recovery.md", "production-readiness.md", "t15-blocker-closure.md", "operations-handover.md", "local-operations.md", "handover-evidence.md",
)] + [ROOT / "docs/user-guide.md"]


def check():
    errors = []
    for path in DOCUMENTS:
        content = path.read_text(encoding="utf-8")
        for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", content):
            target = target.split("#", 1)[0]
            if target and not re.match(r"[a-z]+://", target):
                if not (path.parent / target).exists():
                    errors.append(f"Broken link: {path.name}: {target}")

    inventory = (PHASE / "configuration-inventory.md").read_text(encoding="utf-8")
    for path in (ROOT / "apps/api/src").rglob("*.ts"):
        content = path.read_text(encoding="utf-8")
        for key in re.findall(r"\benv\.([A-Z][A-Z0-9_]*)", content):
            if key not in inventory:
                errors.append(f"Missing configuration inventory key: {key}")

    current = PHASE / "verification-evidence/handover-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/t15-blocker-closure-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/production-readiness-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/security-capacity-recovery-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/staging-uat-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/immutable-promotion-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/email-monitoring-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/observability-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/external-connectivity-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/runtime-drain-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/backup-recovery-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/database-role-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/edge-network-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/container-hardening-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/frontend-access-verification.json"
    if not current.exists():
        current = PHASE / "verification-evidence/dual-auth-verification.json"
    evidence = json.loads((current if current.exists() else PHASE / "verification-evidence/t02-verification.json").read_text())
    if current.name == "handover-verification.json":
        check_handover(evidence, errors)
    for name in evidence["files_changed"]:
        path = ROOT / name
        if path.suffix not in (".md", ".ts", ".js", ".mjs", ".cjs", ".json", ".py", ".sh", ".yml") and path.name not in (".env.example", "Dockerfile", ".dockerignore"):
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.rstrip() != line or line.startswith(("<<<<<<<", ">>>>>>>")):
                errors.append(f"Whitespace/conflict marker: {name}:{number}")
    if errors:
        raise SystemExit("\n".join(errors))
    if current.name == "handover-verification.json":
        print("PASS: T16 task/evidence hashes, deferred blockers, script references, section links and closed production status")
    print(f"PASS: {len(DOCUMENTS)} documents, local links, direct consumed environment inventory and touched-file whitespace")


def check_handover(evidence, errors):
    """Offline consistency, not authenticated acceptance or a deployment permission."""
    expected = {f"T{i:02}": ("PARTIAL" if i in (2, 11, 12, 13, 14, 15) else "COMPLETE") for i in range(1, 17)}
    rows = evidence["taskStatusMatrix"]
    if len(rows) != 16 or {r["task"]: r["currentStatus"] for r in rows} != expected:
        errors.append("T16 task status matrix contradicts preserved scoped task statuses")
    if any(r["previousStatus"] != r["currentStatus"] for r in rows if r["task"] != "T16"):
        errors.append("T16 must not silently upgrade earlier tasks")
    if (evidence["handoverPreparationStatus"] != "COMPLETE" or evidence["productionAcceptanceStatus"] != "NOT STARTED"
            or evidence["phase6Status"] != "HANDOVER PREPARED — PRODUCTION DEFERRED"
            or evidence["productionPromotionStatus"] != "CLOSED — DEFERRED BY PROJECT OWNER"):
        errors.append("T16 preparation/deferred production status inconsistent")
    if any(evidence["safety"].values()) or evidence["source"]["commit"] is not None:
        errors.append("T16 cannot claim production actions or an invented source commit")
    ids = {r["id"] for r in evidence["evidenceIndex"]} | {"E16-FRESH"}
    for row in evidence["evidenceIndex"]:
        path = ROOT / row["path"]
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != row["sha256"]:
            errors.append(f"T16 historical evidence changed or missing: {row['id']}")
    for row in rows + evidence["acceptanceMatrix"]:
        if not set(row["evidenceIds"]) <= ids:
            errors.append("T16 matrix references unknown evidence")
    prerequisites = evidence["deferredPrerequisites"]
    if len(prerequisites) != 13 or {r["id"] for r in prerequisites} != {f"P{i:02}" for i in range(1, 14)}:
        errors.append("T16 deferred prerequisite coverage incomplete")
    canonical = json.loads((PHASE / "verification-evidence/t15-blocker-closure-verification.json").read_text())
    blockers = {r["id"]: r for r in canonical["decisionReview"]["blockers"]}
    for row in prerequisites:
        if row["status"] != "DEFERRED" or not row["releaseBlocking"] or row["canonicalStatus"] != blockers[row["canonicalBlocker"]]["currentStatus"]:
            errors.append("T16 deferred view contradicts canonical T15 blocker")
    scripts = json.loads((ROOT / "package.json").read_text())["scripts"]
    if not set(evidence["runbookScriptNames"]) <= set(scripts):
        errors.append("T16 runbook references an absent package script")
    # Check every npm script in the new local guide against the actual package manifest.
    for path in (PHASE / "local-operations.md", ROOT / "docs/user-guide.md"):
        content = path.read_text(encoding="utf-8")
        for script in re.findall(r"npm(?:\.cmd)? run ([a-zA-Z0-9:_-]+)", content):
            if script not in scripts:
                errors.append(f"Unknown guide package script: {script}")
    for path in (PHASE / "operations-handover.md", PHASE / "local-operations.md", PHASE / "handover-evidence.md", ROOT / "docs/user-guide.md"):
        content = path.read_text(encoding="utf-8")
        for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", content):
            if "#" not in target or re.match(r"[a-z]+://", target):
                continue
            name, anchor = target.split("#", 1)
            linked = path.parent / name if name else path
            if not linked.is_file():
                continue  # Missing files are reported by the existing link checker.
            headings = re.findall(r"^#{1,6}\s+(.+?)\s*$", linked.read_text(encoding="utf-8"), re.M)
            anchors = [re.sub(r"[^\w\- ]", "", h.lower()).replace(" ", "-") for h in headings]
            if anchor not in anchors:
                errors.append(f"Broken handover section anchor: {path.name}: {target}")


if __name__ == "__main__":
    check()
