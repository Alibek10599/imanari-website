# imanari-website

Source for the [Imanari](https://github.com/Alibek10599/imanari) website, published with GitHub Pages at <https://alibek10599.github.io/imanari-website/>.

The site is plain HTML and CSS with no build step. Four pages are generated from a checkout of the main repository: the home page's annotated listing comes from `examples/fieldwork/fieldwork.nari`, `guide.html` from `docs/guide.md`, `spec.html` from `docs/spec.md`, and `changelog.html` from `CHANGELOG.md`. After any of them changes, regenerate and commit the pages:

```sh
python3 tools/gen.py ../imanari
```

The Markdown renderer handles headings, paragraphs, lists, tables, fenced code, inline code, bold and links, which is what those documents use. It stops with an error on anything else rather than rendering it wrong. Relative links point at the file on GitHub.

The guide's playgrounds run in the browser. `play/nari.wasm` is the compiler's own parser, checker and formatter built for WebAssembly, and `play/app.js` and `play/app.css` are the browser client every Imanari app ships. `play.js` mounts that client against an in-memory stand-in for the backend, which follows the runtime's rules for ownership, revisions and idempotency keys but is not the Rust runtime. After the compiler or the client changes, rebuild and commit them (needs rustup):

```sh
sh tools/wasm.sh ../imanari
```

`tools/gen.py` decides which guide section gets which playground.

`site.js` adds the interactive parts: copy buttons, platform tabs, the release walkthrough, the highlighter sweep on the listing, and the spec's contents tracking. Every page reads fine without it.

Download links point at `releases/latest/download/` in the main repository, so new releases need no change here as long as the archive names stay the same.

Licensed under the MIT license ([LICENSE](LICENSE)).
