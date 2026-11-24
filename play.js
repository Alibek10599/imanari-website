const still = matchMedia("(prefers-reduced-motion: reduce)");
const STEP_MS = 150;
const BOOT_MS = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const USERS = [
  { key: "a", label: "User A", id: "00000000-0000-4000-8000-00000000000a" },
  { key: "b", label: "User B", id: "00000000-0000-4000-8000-00000000000b" },
];
const SCENARIOS = {
  hello: { panes: [["Browser", "a"]] },
  ownership: {
    panes: [["User A's browser", "a"], ["User B's browser", "b"]],
    seed: [["a", "create_task", { title: "Order chalk" }], ["a", "create_task", { title: "Book the mats" }], ["b", "create_task", { title: "Wash the gi" }]],
  },
  revision: { panes: [["Tab 1", "a"], ["Tab 2", "a"]], seed: [["a", "create_task", { title: "Call the supplier" }]] },
  retry: { panes: [["Browser", "a"]], drop: true },
  recovery: {
    panes: [["Browser", "a"]],
    crash: true,
    seed: [["a", "create_task", { title: "Order chalk" }], ["a", "create_task", { title: "Book the mats" }]],
  },
};

function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "text") node.textContent = String(value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const literal = (value) => Object.values(value)[0];

let toolchain;
function load() {
  toolchain ??= Promise.all([
    fetch("play/nari.wasm").then((r) => r.arrayBuffer()).then((bytes) => WebAssembly.instantiate(bytes)),
    fetch("play/app.js").then((r) => r.text()),
    fetch("play/app.css").then((r) => r.text()),
  ]).then(([wasm, client, css]) => {
    const x = wasm.instance.exports;
    const call = (name, source) => {
      const bytes = new TextEncoder().encode(source);
      const at = x.nari_buffer(bytes.length);
      new Uint8Array(x.memory.buffer, at, bytes.length).set(bytes);
      const length = x[name]();
      return JSON.parse(new TextDecoder().decode(new Uint8Array(x.memory.buffer, x.nari_result(), length)));
    };
    return {
      compile: (source) => call("nari_compile", source),
      format: (source) => call("nari_format", source),
      client,
      css: css.replace(/(^|[\s,}])(:root|body)(?=[\s,{])/g, "$1:host"),
    };
  });
  return toolchain;
}

function checkValue(name, type, value) {
  if (value === undefined) return `'${name}' is required`;
  if (type.name === "Text") {
    if (typeof value !== "string") return `'${name}' must be text`;
    const length = [...value].length;
    if (length < type.min_length || length > type.max_length) return `'${name}' must have ${type.min_length}..${type.max_length} characters`;
  } else if (type.name === "Bool") {
    if (typeof value !== "boolean") return `'${name}' must be true or false`;
  } else if (type.name === "UUID") {
    if (typeof value !== "string" || !UUID.test(value)) return `'${name}' must be a canonical lowercase UUID`;
  } else if (!Number.isSafeInteger(value)) {
    return `'${name}' must be an integer within ±${Number.MAX_SAFE_INTEGER}`;
  }
  return null;
}

function createBackend(app) {
  const tables = new Map(app.entities.map((entity) => [entity.name, []]));
  const receipts = new Map();
  let serial = 0;

  function newId() {
    serial += 1;
    const random = crypto.randomUUID();
    return serial.toString(16).padStart(8, "0") + random.slice(8);
  }

  function execute(action, actor, key, input) {
    const steps = [];
    const pass = (label, note) => steps.push({ label, note, ok: true });
    const stop = (label, status, code, message, field) => {
      steps.push({ label, note: code, ok: false });
      return { steps, status, body: { error: { code, message, ...(field ? { field } : {}) } } };
    };
    const entity = app.entities.find((e) => e.name === action.entity);
    const table = tables.get(entity.name);
    const owner = entity.owner_field;
    pass("Session", actor.label);

    if (action.kind === "list") {
      const unknown = Object.keys(input).find((k) => k !== "limit" && k !== "after");
      if (unknown) return stop("Input", 400, "INVALID_INPUT", `unknown input field '${unknown}'`, unknown);
      const limit = input.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return stop("Input", 400, "INVALID_INPUT", "'limit' must be an integer in 1..100", "limit");
      const after = input.after ?? null;
      if (after !== null && !UUID.test(after)) return stop("Input", 400, "INVALID_INPUT", "'after' must be a canonical lowercase UUID", "after");
      pass("Input", "valid");
      const mine = table.filter((row) => row[owner] === actor.id).sort((a, b) => (a.id < b.id ? -1 : 1));
      pass("Owner filter", `${mine.length} of ${table.length} rows`);
      const rest = mine.filter((row) => after === null || row.id > after);
      const items = rest.slice(0, limit).map((row) => ({ ...row }));
      pass("Respond", "200");
      return { steps, status: 200, body: { data: { items, next_cursor: rest.length > limit ? items[items.length - 1].id : null } } };
    }

    if (!key) return stop("Idempotency", 400, "INVALID_INPUT", "mutations require an Idempotency-Key header of 1..128 visible ASCII characters");
    const unknown = Object.keys(input).find((k) => !action.inputs.some((i) => i.name === k));
    if (unknown) return stop("Input", 400, "INVALID_INPUT", `unknown input field '${unknown}'`, unknown);
    for (const spec of action.inputs) {
      const problem = checkValue(spec.name, spec.type, input[spec.name]);
      if (problem) return stop("Input", 400, "INVALID_INPUT", problem, spec.name);
    }
    pass("Input", "valid");

    const receipt = [actor.id, action.name, key].join("\u0000");
    const hash = JSON.stringify(action.inputs.map((i) => [i.name, input[i.name]]));
    const seen = receipts.get(receipt);
    if (seen && seen.hash !== hash) return stop("Idempotency", 409, "IDEMPOTENCY_CONFLICT", "this Idempotency-Key was already used with different input");
    if (seen) {
      pass("Idempotency", "key seen");
      pass("Replay", "nothing written");
      return { steps, status: 200, body: { data: seen.data } };
    }
    pass("Idempotency", "new key");

    const resolve = (binding) => (binding.from === "input" ? input[binding.input] : binding.from === "actor_id" ? actor.id : literal(binding.value));
    const assign = (row) => {
      for (const set of action.set) {
        const field = entity.fields.find((f) => f.name === set.field);
        const value = resolve(set.binding);
        const problem = checkValue(set.binding.input ?? set.field, field.type, value);
        if (problem) return { problem, field: set.binding.input };
        row[set.field] = value;
      }
      return null;
    };

    let row;
    if (action.kind === "insert") {
      row = { id: newId(), revision: 1 };
      for (const field of entity.fields) if (field.default) row[field.name] = literal(field.default);
      const bad = assign(row);
      if (bad) return stop("Insert", 400, "INVALID_INPUT", bad.problem, bad.field);
      table.push(row);
      pass("Insert", `owner = ${actor.label}`);
    } else {
      const id = input[action.id_input];
      const expected = input[action.revision_input];
      row = table.find((r) => r.id === id && r[owner] === actor.id);
      if (!row) return stop("Find own row", 404, "NOT_FOUND", "record not found");
      pass("Find own row", "found");
      if (row.revision !== expected) return stop("Revision", 409, "REVISION_CONFLICT", "the record changed since it was loaded; refresh and retry");
      pass("Revision", `${expected} is current`);
      const next = { ...row };
      const bad = assign(next);
      if (bad) return stop("Update", 400, "INVALID_INPUT", bad.problem, bad.field);
      Object.assign(row, next, { revision: row.revision + 1 });
    }
    pass("Commit", `revision ${row.revision}`);
    const data = { ...row };
    receipts.set(receipt, { hash, data });
    return { steps, status: 200, body: { data }, changed: row.id };
  }

  return { tables, execute };
}

function boot(figure, tools) {
  const scenario = SCENARIOS[figure.dataset.scenario];
  const area = figure.querySelector("textarea");
  const original = area.value;
  area.readOnly = false;
  area.spellcheck = false;
  area.setAttribute("autocapitalize", "off");
  area.setAttribute("autocomplete", "off");

  const status = h("p", { class: "pg-status", role: "status" });
  const problems = h("ol", { class: "pg-problems", "aria-label": "Compiler diagnostics" });
  const stage = h("div", { class: "pg-panes" });
  const store = h("div", { class: "pg-store" });
  const trace = h("ol", { class: "pg-trace", "aria-label": "Recent requests, newest first" });
  const ir = h("pre", { class: "pg-ir", tabindex: "0" });
  const controls = h("div", { class: "pg-controls" });

  let current = null;
  let backend = null;
  let up = true;
  let dropNext = false;
  let panes = [];

  const dropButton = scenario.drop
    ? h("button", {
        type: "button",
        class: "pg-toggle",
        "aria-pressed": "false",
        text: "Lose the next response",
        onclick: () => {
          dropNext = !dropNext;
          dropButton.setAttribute("aria-pressed", String(dropNext));
        },
      })
    : null;
  if (dropButton) controls.append(dropButton, h("span", { class: "pg-hint", text: "The change commits, but the reply never reaches the browser." }));

  let supervisor = null;
  if (scenario.crash) {
    const state = h("strong", { class: "sv-state" });
    const pips = h("span", { class: "sv-pips", "aria-hidden": "true" });
    const budget = h("span", { class: "sv-budget" });
    const wait = h("span", { class: "sv-wait", "aria-hidden": "true" }, h("span"));
    const log = h("p", { class: "sv-log", role: "status" });
    const crashButton = h("button", { type: "button", text: "Crash the backend", onclick: () => supervisor.crash() });
    const ackButton = h("button", { type: "button", text: "Acknowledge and restart", hidden: true, onclick: () => supervisor.acknowledge() });
    const box = h("div", { class: "pg-supervisor" }, h("p", { class: "sv-head" }, "Supervisor: ", state), h("p", { class: "sv-line" }, pips, budget), wait, log, h("p", { class: "sv-actions" }, crashButton, ackButton));
    let restarts = [];
    let timer;
    const policy = () => current.app.recovery;
    const used = () => {
      const now = Date.now();
      restarts = restarts.filter((t) => now - t < policy().window_seconds * 1000);
      return restarts.length;
    };
    const draw = (name) => {
      if (name) {
        box.dataset.state = name;
        state.textContent = name;
      }
      const max = policy().max_restarts;
      const n = used();
      pips.replaceChildren(...Array.from({ length: max }, (_, i) => h("i", { class: i < n ? "spent" : null })));
      budget.textContent = `${n} of ${max} restarts used in the last ${policy().window_seconds} s`;
      crashButton.disabled = !up;
      ackButton.hidden = box.dataset.state !== "StoppedNeedsAttention";
    };
    const start = async (message) => {
      draw("Starting");
      log.textContent = message;
      await sleep(BOOT_MS);
      up = true;
      draw("Healthy");
      log.textContent = "The backend is back. Committed rows are still in the database.";
      mount();
    };
    supervisor = {
      reset() {
        clearTimeout(timer);
        restarts = [];
        up = true;
        draw("Healthy");
        log.textContent = "The backend is running.";
      },
      crash() {
        if (!up) return;
        up = false;
        const n = used();
        if (n >= policy().max_restarts) {
          draw("StoppedNeedsAttention");
          log.textContent = `The restart budget is spent, so the supervisor stopped and recorded an incident. On your machine: nari dev --acknowledge.`;
          return;
        }
        const delay = policy().backoff_ms[n];
        restarts.push(Date.now());
        draw("Backoff");
        log.textContent = `The backend exited. Restart ${n + 1} of ${policy().max_restarts} follows after ${delay} ms.`;
        wait.firstChild.style.animation = "none";
        void wait.firstChild.offsetWidth;
        wait.firstChild.style.animation = still.matches ? "none" : `sv-fill ${delay}ms linear forwards`;
        timer = setTimeout(() => start("Starting the backend again."), delay);
      },
      acknowledge() {
        start("Acknowledged. The restart history is kept, so the budget is still spent until the window passes.");
      },
    };
    controls.append(box);
    setInterval(() => current && draw(), 1000);
  }

  function drawStore(changed) {
    store.replaceChildren();
    for (const entity of current.app.entities) {
      const rows = backend.tables.get(entity.name);
      const columns = [...entity.fields.map((f) => f.name).filter((name) => name !== entity.owner_field), entity.owner_field, "revision"];
      const table = h("table", {}, h("caption", { text: `${entity.name}: ${rows.length} ${rows.length === 1 ? "row" : "rows"} stored` }));
      table.append(h("thead", {}, h("tr", {}, ...columns.map((name) => h("th", { scope: "col", text: name })))));
      const body = h("tbody");
      for (const row of rows) {
        const cells = columns.map((name) => {
          const value = row[name];
          const user = name === entity.owner_field && USERS.find((u) => u.id === value);
          return user ? h("td", {}, h("span", { class: `owner owner-${user.key}`, text: user.label })) : h("td", { text: String(value) });
        });
        body.append(h("tr", { class: row.id === changed ? "changed" : null }, ...cells));
      }
      if (rows.length === 0) body.append(h("tr", {}, h("td", { colspan: columns.length, class: "none", text: "No rows yet." })));
      table.append(body);
      store.append(h("div", { class: "pg-table" }, table));
    }
  }

  function record(pane, action, result) {
    const failed = result.status !== 200;
    const stages = h("span", { class: "stages" });
    result.steps.forEach((step, i) => {
      stages.append(h("span", { class: step.ok ? "stage" : "stage bad", style: `--i:${i}` }, h("b", { text: step.label }), h("small", { text: step.note })));
    });
    const outcome = h("span", { class: "outcome", style: `--i:${result.steps.length}`, text: failed ? `${result.status} ${result.body.error.code}` : "200 OK" });
    const item = h(
      "li",
      { class: failed ? "req failed" : "req" },
      h("span", { class: "who" }, h("span", { class: `owner owner-${pane.user.key}`, text: pane.user.label }), h("code", { text: action.name })),
      stages,
      outcome,
    );
    trace.prepend(item);
    while (trace.children.length > 5) trace.lastChild.remove();
    return {
      settle: still.matches ? Promise.resolve() : sleep(result.steps.length * STEP_MS),
      lost() {
        item.classList.add("lost");
        outcome.textContent = "committed, reply lost";
      },
    };
  }

  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  function mountPane(pane) {
    const address = h("span", { class: "address" });
    const tab = h("span", { class: "tab", text: pane.title });
    const host = h("div", { class: "pg-app" });
    const frame = h("div", { class: "pg-pane" }, h("div", { class: "chrome" }, tab, address), host);
    const root = host.attachShadow({ mode: "open" });
    root.append(
      h("style", { text: tools.css + ":host{display:block;margin:0;max-width:none;padding:1rem;background:Canvas;color:CanvasText;font-size:1rem}h1{font-size:1.5rem;margin-top:0}h2{font-size:1.1rem}" }),
      h("header", { id: "dev-bar", "aria-label": "Development identity" }),
      h("main", { id: "app" }),
    );
    const route = current.web.screens[0]?.route ?? "/";
    address.textContent = `127.0.0.1:${current.app.runtime.port}${route}`;
    const page = {
      getElementById: (id) => root.getElementById(id),
      createElement: (name) => document.createElement(name),
      set title(value) {
        tab.textContent = `${pane.title} · ${value}`;
      },
    };
    const request = async (url, init = {}) => {
      const path = String(url);
      if (!up) throw new TypeError("backend is down");
      if (path === "/assets/nari.json") return reply(200, current.web);
      if (path === "/_nari/session") {
        const { id, label } = pane.user;
        return reply(200, { data: { user: { id, label, csrf: "playground" }, dev: { csrf: "playground", users: USERS } } });
      }
      if (path === "/_nari/dev/select") {
        pane.user = USERS.find((u) => u.key === JSON.parse(init.body).user) ?? pane.user;
        return reply(200, { data: { user: pane.user.key } });
      }
      const action = path.startsWith("/api/actions/") && current.app.actions.find((a) => a.name === decodeURIComponent(path.slice(13)));
      if (!action) return reply(404, { error: { code: "UNKNOWN_ACTION", message: "no such action" } });
      const result = backend.execute(action, pane.user, init.headers?.["Idempotency-Key"], JSON.parse(init.body));
      const entry = record(pane, action, result);
      await entry.settle;
      if (action.kind !== "list") drawStore(result.changed);
      if (dropNext && result.changed) {
        dropNext = false;
        dropButton.setAttribute("aria-pressed", "false");
        entry.lost();
        throw new TypeError("response lost");
      }
      return reply(result.status, result.body);
    };
    new Function("document", "fetch", "location", "history", tools.client)(page, request, { pathname: route, hash: "" }, { replaceState() {} });
    return frame;
  }

  function mount() {
    stage.replaceChildren(...panes.map(mountPane));
  }

  function start(result) {
    current = result;
    backend = createBackend(result.app);
    panes = scenario.panes.map(([title, key]) => ({ title, user: USERS.find((u) => u.key === key) }));
    if (area.value === original) {
      for (const [key, name, input] of scenario.seed ?? []) {
        const action = result.app.actions.find((a) => a.name === name);
        if (action) backend.execute(action, USERS.find((u) => u.key === key), crypto.randomUUID(), input);
      }
    }
    trace.replaceChildren();
    ir.textContent = result.ir;
    supervisor?.reset();
    drawStore();
    mount();
  }

  function select(diagnostic) {
    const bytes = new TextEncoder().encode(area.value);
    const index = (offset) => new TextDecoder().decode(bytes.slice(0, offset)).length;
    area.focus();
    area.setSelectionRange(index(diagnostic.span.start), index(Math.max(diagnostic.span.end, diagnostic.span.start + 1)));
  }

  function build() {
    const result = tools.compile(area.value);
    problems.replaceChildren(
      ...result.diagnostics.map((d) =>
        h(
          "li",
          {},
          h("button", { type: "button", onclick: () => select(d) }, h("span", { class: "at", text: `${d.line}:${d.column}` }), h("code", { text: d.code }), ` ${d.message}`, d.node_id ? h("span", { class: "node", text: ` [${d.node_id}]` }) : null),
        ),
      ),
    );
    figure.classList.toggle("broken", !result.ok);
    if (!result.ok) {
      const n = result.diagnostics.length;
      status.textContent = `${n} ${n === 1 ? "error" : "errors"}. The app below is the last version that compiled.`;
      return;
    }
    result.app = JSON.parse(result.ir).app;
    const version = JSON.parse(result.ir).compiler;
    const changed = !current || current.ir !== result.ir;
    status.textContent = `Compiled with ${version}.${current && changed ? " The app restarted with an empty database." : ""}`;
    if (changed) start(result);
  }

  let pending;
  area.addEventListener("input", () => {
    clearTimeout(pending);
    pending = setTimeout(build, 250);
  });

  const format = h("button", {
    type: "button",
    text: "Format",
    onclick: () => {
      const out = tools.format(area.value);
      if (out.ok) area.value = out.source;
      build();
    },
  });
  const reset = h("button", {
    type: "button",
    text: "Reset",
    onclick: () => {
      area.value = original;
      current = null;
      build();
    },
  });
  const editor = h("div", { class: "pg-editor" }, h("div", { class: "pg-bar" }, h("span", { class: "file", text: figure.dataset.file }), format, reset));
  area.replaceWith(editor);
  editor.append(area, status, problems);

  const run = h(
    "div",
    { class: "pg-run" },
    controls.children.length ? controls : null,
    stage,
    h("h4", { text: "Requests" }),
    h("p", { class: "pg-hint", text: "Every call the app makes, and each check the backend runs on it." }),
    trace,
    h("h4", { text: "Database" }),
    h("p", { class: "pg-hint", text: "All stored rows, including the ones the signed-in user is not allowed to see." }),
    store,
  );
  const output = h("details", { class: "pg-output" }, h("summary", { text: "Compiler output: ir.json" }), ir);
  const source = figure.querySelector(".pg-source");
  if (figure.classList.contains("side")) source.replaceChildren(editor, output);
  else source.replaceChildren(h("details", { class: "pg-edit" }, h("summary", { text: `Edit the program: ${figure.dataset.file}` }), editor, output));
  source.after(run);
  figure.classList.add("live");
  build();
}

const figures = [...document.querySelectorAll(".playground")];
if (figures.length) {
  load().then(
    (tools) => figures.forEach((figure) => boot(figure, tools)),
    () => figures.forEach((figure) => figure.querySelector(".pg-fallback").replaceChildren("The playground could not load. Reload the page to try again.")),
  );
}
