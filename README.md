# imanari-website

Source for the [Imanari](https://github.com/Alibek10599/imanari) website, published with GitHub Pages at <https://alibek10599.github.io/imanari-website/>.

The site is plain HTML and CSS with no build step. Three pages are generated from a checkout of the main repository: the home page's annotated listing comes from `examples/fieldwork/fieldwork.nari`, `spec.html` from `docs/spec.md`, and `changelog.html` from `CHANGELOG.md`. After any of them changes, regenerate and commit the pages:

```sh
python3 tools/gen.py ../imanari
```

The Markdown renderer handles headings, paragraphs, lists, tables, fenced code, inline code, bold and links, which is what those documents use. It stops with an error on anything else rather than rendering it wrong. Relative links point at the file on GitHub, and each page names the commit it was rendered from.

Download links point at `releases/latest/download/` in the main repository, so new releases need no change here as long as the archive names stay the same.

Licensed under the MIT license ([LICENSE](LICENSE)).
