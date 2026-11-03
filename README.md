# frame-website

Source for the [Frame](https://github.com/Alibek10599/frame) website, published with GitHub Pages at <https://alibek10599.github.io/frame-website/>.

The site is plain HTML and CSS with no build step. The annotated listing on the home page is generated from the reference app in the main repository. After that example changes, regenerate the page and commit `index.html`:

```sh
python3 tools/gen.py ../frame/examples/fieldwork/fieldwork.frame index.html
```

Download links point at `releases/latest/download/` in the main repository, so new releases need no change here as long as the archive names stay the same.

Licensed under the MIT license ([LICENSE](LICENSE)).
