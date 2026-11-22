const root = document.documentElement;
root.classList.add("js");
const calm = matchMedia("(prefers-reduced-motion: reduce)");

for (const pre of document.querySelectorAll(".platform pre, .prose pre, .doc pre")) {
  const block = document.createElement("div");
  block.className = "codeblock";
  block.style.margin = getComputedStyle(pre).margin;
  pre.style.margin = "0";
  pre.replaceWith(block);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy";
  button.textContent = "Copy";
  let reset;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(pre.innerText.trimEnd());
      button.textContent = "Copied";
    } catch {
      getSelection().selectAllChildren(pre);
      button.textContent = "Selected";
    }
    clearTimeout(reset);
    reset = setTimeout(() => (button.textContent = "Copy"), 1800);
  });
  block.append(pre, button);
}

const platforms = document.querySelector(".platforms");
if (platforms) {
  const panels = [...platforms.querySelectorAll(".platform")];
  const list = document.createElement("div");
  list.className = "tabs";
  list.setAttribute("role", "tablist");
  list.setAttribute("aria-label", "Platform");
  const select = (index, focus) => {
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
    if (focus) tabs[index].focus();
  };
  const tabs = panels.map((panel, index) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = `tab-${panel.id}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panel.id);
    tab.textContent = panel.querySelector("h3").textContent;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    tab.addEventListener("click", () => select(index));
    tab.addEventListener("keydown", (event) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (event.key === "Home") select(0, true);
      else if (event.key === "End") select(panels.length - 1, true);
      else if (step) select((index + step + panels.length) % panels.length, true);
      else return;
      event.preventDefault();
    });
    list.append(tab);
    return tab;
  });
  platforms.before(list);
  const ua = `${navigator.userAgentData?.platform ?? ""} ${navigator.platform} ${navigator.userAgent}`;
  const linux = /linux/i.test(ua) && !/android/i.test(ua);
  select(linux ? (/aarch64|arm64|armv8/i.test(ua) ? 2 : 1) : 0);
}

const rollout = document.querySelector(".rollout");
if (rollout) {
  const steps = [...document.querySelectorAll(".steps li")];
  const status = rollout.querySelector(".status");
  const blue = rollout.querySelector(".state-blue");
  const green = rollout.querySelector(".state-green");
  const play = document.querySelector(".play");
  const states = [
    ["v1 serving", "idle", "Version 1 serves all traffic."],
    ["v1 serving", "v2 starting", "Version 2 starts next to version 1. Traffic still goes to version 1."],
    ["v1 serving", "v2 ready", "Version 2 is ready and healthy. Traffic still goes to version 1."],
    ["v1 draining", "v2 serving", "The proxy now routes to version 2. Version 1 drains."],
    ["stopped", "v2 serving", "Version 1 is stopped. Version 2 serves all traffic."],
  ];
  let timer;
  const show = (step) => {
    rollout.dataset.step = step;
    [blue.textContent, green.textContent, status.textContent] = states[step];
    steps.forEach((item, i) => {
      if (i === step - 1) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
  };
  steps.forEach((item, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.append(...item.childNodes);
    button.addEventListener("click", () => {
      clearTimeout(timer);
      play.disabled = false;
      play.textContent = "Play a release";
      show(i + 1);
    });
    item.append(button);
  });
  const run = (step) => {
    show(step);
    if (step < states.length - 1) {
      timer = setTimeout(() => run(step + 1), calm.matches ? 900 : 1500);
    } else {
      play.disabled = false;
      play.textContent = "Play again";
    }
  };
  play.hidden = false;
  play.addEventListener("click", () => {
    clearTimeout(timer);
    play.disabled = true;
    play.textContent = "Releasing";
    show(0);
    timer = setTimeout(() => run(1), 500);
  });
}

const code = document.querySelector(".listing .code");
if (code && "IntersectionObserver" in window) {
  code.classList.add("sweep");
  const seen = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      code.classList.add("inview");
      seen.disconnect();
    }
  }, { threshold: 0.15 });
  seen.observe(code);
}

const toc = document.querySelector(".toc");
if (toc) {
  const wide = matchMedia("(min-width: 64rem)");
  const sync = () => (toc.open = wide.matches);
  sync();
  wide.addEventListener("change", sync);
  const links = [...toc.querySelectorAll("a")];
  const heads = links.map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))));
  let current = -1;
  const update = () => {
    const line = Math.min(innerHeight * 0.3, 240);
    let active = 0;
    heads.forEach((head, i) => {
      if (head.getBoundingClientRect().top < line) active = i;
    });
    if (active === current) return;
    links[current]?.removeAttribute("aria-current");
    links[active].setAttribute("aria-current", "location");
    current = active;
  };
  let queued = false;
  addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  }, { passive: true });
  update();
  toc.addEventListener("click", (event) => {
    if (event.target.closest("a") && !wide.matches) toc.open = false;
  });
}
