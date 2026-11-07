"""Read-only Phase 6 plan checks; Python standard library, no deployment/network action."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[4]
PLAN = ROOT / 'docs/ai-agent-platform/phase-6'
DOCUMENTS = sorted(PLAN.glob('*.md')) + [ROOT / p for p in [
    'README.md', 'WORKSPACE.md', 'docs/ai-agent-platform/README.md',
    'docs/ai-agent-platform/phase-5/README.md',
    'docs/ai-agent-platform/phase-5/implementation-plan.md']]
issues = []
diagrams = []
for path in DOCUMENTS:
    value = path.read_text(encoding='utf-8-sig')
    for number, line in enumerate(value.splitlines(), 1):
        if line.rstrip() != line:
            issues.append(f'{path.relative_to(ROOT)}:{number}: trailing whitespace')
    if value.count('```') % 2:
        issues.append(f'{path.relative_to(ROOT)}: unmatched code fence')
    for target in re.findall(r'\]\(([^)]+)\)', value):
        if target.startswith(('http:', 'https:', 'mailto:', 'data:')):
            continue
        file_part, _, anchor = target.partition('#')
        resolved = (path.parent / file_part).resolve() if file_part else path
        if not resolved.exists():
            issues.append(f'{path.relative_to(ROOT)}: missing link {target}')
        elif anchor and PLAN in resolved.parents and resolved.suffix == '.md':
            headings = re.findall(r'^#{1,6} (.+)$', resolved.read_text(), re.M)
            slugs = {re.sub(r'[^\w\- ]', '', h.lower()).replace(' ', '-') for h in headings}
            if anchor not in slugs:
                issues.append(f'{path.relative_to(ROOT)}: missing plan anchor {target}')
    if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\bsk-proj-[A-Za-z0-9_-]{60,}\b', value):
        issues.append(f'{path.relative_to(ROOT)}: credential pattern')
    blocks = re.findall(r'```mermaid\s*\n(.*?)```', value, re.S)
    for block in blocks:
        if not block.strip().startswith('flowchart ') or block.count('[') != block.count(']'):
            issues.append(f'{path.relative_to(ROOT)}: invalid structural diagram check')
    diagrams.extend(blocks)
if len(diagrams) != 5:
    issues.append('Expected the five reviewed topology/network/runtime/promotion/backup diagrams')
roadmap = (PLAN / 'implementation-plan.md').read_text()
rows = [line.split('|') for line in roadmap.splitlines() if re.match(r'^\| T\d{2} ', line)]
tasks = [re.match(r' T(\d{2}) ', row[1]).group(1) for row in rows]
if tasks != [f'{n:02}' for n in range(1, 17)]:
    issues.append('Roadmap must contain unique ordered T01-T16 tasks')
for row in rows:
    number = int(re.match(r' T(\d{2}) ', row[1]).group(1))
    for dependency in re.findall(r'T(\d{2})', row[2]):
        if int(dependency) >= number or dependency not in tasks:
            issues.append(f'T{number:02}: invalid forward/missing dependency T{dependency}')
evidence = PLAN / 'verification-evidence/t01-verification.json'
if evidence.exists():
    record = json.loads(evidence.read_text())
    for name, expected in record['preservation']['protectedHashes'].items():
        file = ROOT / name
        if not file.exists() or hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            issues.append(f'Protected preexisting file changed: {name}')
if issues:
    raise SystemExit('\n'.join(issues))
print(f'PASS: {len(DOCUMENTS)} documents, local links/plan anchors, whitespace, fences, five diagram structures, T01-T16 dependency order and credential-pattern checks')
print('Mermaid rendering/full grammar and Markdown lint are NOT RUN: no existing installed CLI/parser; structure/manual review is separate.')
if evidence.exists():
    print('PASS: preexisting protected source/configuration/test/artifact hashes')
