import html
import posixpath
import re
import subprocess
import sys
from pathlib import Path

repo = Path(sys.argv[1])
site = Path(__file__).resolve().parent.parent
lines = (repo / "examples/fieldwork/fieldwork.nari").read_text().rstrip("\n").split("\n")
sha = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()

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

INLINE = re.compile(r"`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\[([^\]]+)\](?!\()|\*\*(.+?)\*\*")
REF = re.compile(r"\[([^\]]+)\]: (\S+)")
LIST = re.compile(r"(-|(\d+)\.) (.*)")
BREAKS = re.compile(r"#{1,6} |```|\||- |\d+\. |>|<")

def text(s):
    return html.escape(s, quote=False)

def href(url, doc):
    if re.match(r"[a-z]+:|#", url):
        return url
    return f"{REPO}/blob/main/{posixpath.normpath(posixpath.join(posixpath.dirname(doc), url))}"

def inline(s, doc, refs):
    out, pos = [], 0
    for m in INLINE.finditer(s):
        out.append(text(s[pos:m.start()]))
        code, label, url, ref, bold = m.groups()
        if code is not None:
            out.append(f"<code>{text(code)}</code>")
        elif label is not None:
            out.append(f'<a href="{html.escape(href(url, doc))}">{inline(label, doc, refs)}</a>')
        elif ref is not None and ref.lower() in refs:
            out.append(f'<a href="{html.escape(href(refs[ref.lower()], doc))}">{inline(ref, doc, refs)}</a>')
        elif ref is not None:
            out.append(text(m.group(0)))
        else:
            out.append(f"<strong>{inline(bold, doc, refs)}</strong>")
        pos = m.end()
    out.append(text(s[pos:]))
    return "".join(out)

def plain(s):
    return re.sub(r"\[([^\]]+)\](\([^)]*\))?|[`*]", lambda m: m.group(1) or "", s)

def slug(s, seen):
    base = re.sub(r"[^\w\- ]", "", plain(s).lower()).replace(" ", "-")
    n = seen.get(base, 0)
    seen[base] = n + 1
    return f"{base}-{n}" if n else base

def cells(row):
    return [c.strip().replace("\\|", "|") for c in re.split(r"(?<!\\)\|", row.strip().strip("|"))]

def markdown(doc):
    src = (repo / doc).read_text().rstrip("\n").split("\n")
    refs = {m.group(1).lower(): m.group(2) for m in map(REF.fullmatch, src) if m}
    out, toc, seen, i = [], [], {}, 0
    while i < len(src):
        line = src[i]
        heading = re.match(r"(#{1,6}) (.*)", line)
        item = LIST.match(line)
        if not line.strip() or REF.fullmatch(line):
            i += 1
        elif line.startswith("```"):
            end = next((j for j in range(i + 1, len(src)) if src[j] == "```"), None)
            if end is None:
                raise SystemExit(f"{doc}:{i + 1}: unclosed code fence")
            lang = line[3:].strip()
            cls = f' class="language-{html.escape(lang)}"' if lang else ""
            out.append(f"<pre><code{cls}>{text(chr(10).join(src[i + 1:end]))}</code></pre>")
            i = end + 1
        elif heading:
            level, title = len(heading.group(1)), heading.group(2)
            ident = slug(title, seen)
            if level == 2:
                toc.append((ident, text(plain(title))))
            out.append(f'<h{level} id="{ident}">{inline(title, doc, refs)}</h{level}>')
            i += 1
        elif line.startswith("|"):
            end = i
            while end < len(src) and src[end].startswith("|"):
                end += 1
            if end - i < 2 or not re.fullmatch(r"[\s|:-]+", src[i + 1]):
                raise SystemExit(f"{doc}:{i + 1}: table without a separator row")
            head = "".join(f"<th>{inline(c, doc, refs)}</th>" for c in cells(src[i]))
            body = "".join(
                "<tr>" + "".join(f"<td>{inline(c, doc, refs)}</td>" for c in cells(r)) + "</tr>"
                for r in src[i + 2:end]
            )
            out.append(f'<div class="table"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
            i = end
        elif item:
            ordered = item.group(2) is not None
            first = int(item.group(2) or 1)
            items = []
            while i < len(src) and src[i].strip() and not REF.fullmatch(src[i]):
                m = LIST.match(src[i])
                if m and (m.group(2) is not None) != ordered:
                    break
                if m:
                    items.append(m.group(3))
                else:
                    items[-1] += " " + src[i].strip()
                i += 1
            tag = "ol" if ordered else "ul"
            start = f' start="{first}"' if ordered and first != 1 else ""
            out.append(f"<{tag}{start}>" + "".join(f"<li>{inline(t, doc, refs)}</li>" for t in items) + f"</{tag}>")
        elif re.match(r">|<| {4}|\t", line):
            raise SystemExit(f"{doc}:{i + 1}: unsupported markdown: {line}")
        else:
            end = i + 1
            while end < len(src) and src[end].strip() and not BREAKS.match(src[end]) and not REF.fullmatch(src[end]):
                end += 1
            out.append(f"<p>{inline(' '.join(l.strip() for l in src[i:end]), doc, refs)}</p>")
            i = end
    return toc, "\n".join(out)

def doc_main(doc, contents):
    toc, body = markdown(doc)
    nav = ""
    if contents:
        links = "".join(f'<li><a href="#{ident}">{title}</a></li>' for ident, title in toc)
        nav = f'<nav class="toc" aria-label="Contents"><p>Contents</p><ul>{links}</ul></nav>\n'
    source = (
        f'<p class="source">Rendered from <a href="{REPO}/blob/{sha}/{doc}">{doc}</a> '
        f'at commit <a href="{REPO}/commit/{sha}"><code>{sha[:7]}</code></a>.</p>'
    )
    kind = "doc with-toc" if contents else "doc"
    return f'<main class="{kind}">\n{nav}<article>\n{body}\n{source}\n</article>\n</main>'

shell = (site / "tools/page.template.html").read_text().replace("{{REPO}}", REPO).replace("{{DL}}", DL)

def write(name, title, description, main):
    page = shell.replace("{{TITLE}}", text(title)).replace("{{DESCRIPTION}}", text(description).replace('"', "&quot;"))
    page = page.replace(f'<a href="{name}">', f'<a href="{name}" aria-current="page">')
    (site / name).write_text(page.replace("{{MAIN}}", main))

home = (site / "tools/index.template.html").read_text().rstrip("\n").replace("{{REPO}}", REPO).replace("{{DL}}", DL)
write(
    "index.html",
    "Imanari: one file describes the whole app",
    "Imanari is a small language for declaring an app's data, actions, screens, limits, recovery and repair in one file. It compiles to a native Rust backend and a browser UI.",
    home.replace("{{LISTING}}", "\n".join(rows)),
)
write(
    "spec.html",
    "Imanari specification",
    "The Imanari specification: the language, compiler, runtime, recovery and repair contract, and the release plan.",
    doc_main("docs/spec.md", True),
)
write(
    "changelog.html",
    "Imanari changelog",
    "Every notable change to Imanari, release by release.",
    doc_main("CHANGELOG.md", False),
)
print(f"wrote index.html, spec.html and changelog.html from {sha[:7]} ({len(lines)} listing lines, {len(notes)} notes)")
