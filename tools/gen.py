import html
import re
import sys
from pathlib import Path

src_path, out_path = Path(sys.argv[1]), Path(sys.argv[2])
lines = src_path.read_text().rstrip("\n").split("\n")

REPO = "https://github.com/Alibek10599/imanari"
DL = REPO + "/releases/latest/download"

def find(text, start=1):
    for i in range(start - 1, len(lines)):
        if text in lines[i]:
            return i + 1
    raise SystemExit(f"not found: {text}")

def block(opening):
    start = find(opening)
    depth = 0
    for i in range(start - 1, len(lines)):
        depth += lines[i].count("{") - lines[i].count("}")
        if depth == 0:
            return start, i + 1
    raise SystemExit(f"unclosed: {opening}")

notes = [
    (block("entity Task {"), "owner_field = owner;",
     "Every task belongs to a user. Generated queries are scoped to the signed-in owner, so one user can never read or change another user's tasks."),
    (block("action create_task {"), "owner: @actor.id,",
     "The owner comes from the session, never from the request body. Inputs are checked against their declared bounds before any SQL runs."),
    (block("action complete_task {"), "expected_revision = @input.revision;",
     "Updates check the record's revision. A stale write gets a conflict instead of silently overwriting someone else's change."),
    (block("screen tasks {"), "action = complete_task;",
     "Screens are built from native browser controls and bound to actions. A button can only call what its action allows."),
    (block("runtime local {"), "request_limit_bytes = 65536;",
     "Limits live in the source. The runtime enforces body size, timeouts and per-user rate limits on every request."),
    (block("recovery backend_process {"), "max_restarts = 3;",
     "A separate supervisor restarts the backend within this budget. When the budget runs out, it stops and tells you instead of looping."),
    (block("repair local_candidate {"), "editable_actions = [complete_task];",
     "When a protected test fails, Imanari proposes a fix and validates it in a sandbox. It may edit only these actions, and nothing ships until you apply it."),
]

KEYWORDS = r"\b(imanari|app|identity|entity|field|action|input|screen|form|list|button|runtime|recovery|repair)\b(?= [\w\"])"

def render(line):
    stripped = line.lstrip()
    if stripped.startswith("//"):
        return f'<span class="c">{html.escape(line)}</span>'
    out = html.escape(line)
    out = re.sub(r"^(\s*)" + KEYWORDS, r'\1<span class="k">\2</span>', out)
    out = re.sub(r"(@[a-z_.]+)", r'<span class="r">\1</span>', out)
    return out

segments = []
cursor = 1
for (start, end), mark, note in notes:
    if cursor < start:
        segments.append((cursor, start - 1, None, None))
    segments.append((start, end, find(mark, start), note))
    cursor = end + 1
if cursor <= len(lines):
    segments.append((cursor, len(lines), None, None))

rows = []
for start, end, hl, note in segments:
    code = []
    for n in range(start, end + 1):
        cls = ' class="hl"' if n == hl else ""
        code.append(f'<span{cls} data-n="{n}">{render(lines[n - 1])}</span>')
    aside = f'<p class="note" style="--at:{hl - start}">{html.escape(note)}</p>' if note else ""
    rows.append(
        f'<div class="seg{" annotated" if note else ""}"><pre><code>{"".join(code)}</code></pre>{aside}</div>'
    )

template = Path(__file__).with_name("index.template.html").read_text()
page = (
    template.replace("{{LISTING}}", "\n".join(rows))
    .replace("{{REPO}}", REPO)
    .replace("{{DL}}", DL)
)
out_path.write_text(page)
print(f"wrote {out_path} ({len(lines)} source lines, {len(notes)} notes)")
