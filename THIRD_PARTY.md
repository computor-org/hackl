# Third-Party Provenance

Hackl is MIT licensed. See `LICENSE`.

Hackl is not a fork of `ggml-org/llama.vscode`.

The initial design was informed by public inspection of:

- `ggml-org/llama.vscode`, MIT license, especially its VS Code local-LLM
  extension surface, `/infill` support, and OpenAI-compatible endpoint handling.

No source code has been copied from `llama.vscode` in the initial scaffold.
If future commits copy or closely adapt code, record the copied files, upstream
commit, copyright notice, and MIT license text here.

## Bundled Runtime Assets

The VSIX bundles the following runtime assets for the Hackl chat webview. They
are loaded from the extension package and not from a network CDN.

### markdown-it

- Package: `markdown-it`
- Version: 14.1.1
- Source: `https://github.com/markdown-it/markdown-it`
- Bundled files: `media/vendor/markdown-it/markdown-it.min.js`,
  `media/vendor/licenses/markdown-it/LICENSE`
- License: MIT
- Copyright notice: Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin.
- Changes: none.

### KaTeX

- Package: `katex`
- Version: 0.16.45
- Source: `https://github.com/KaTeX/KaTeX`
- Bundled files: `media/vendor/katex/katex.min.js`,
  `media/vendor/katex/katex.min.css`, `media/vendor/katex/fonts/**`,
  `media/vendor/licenses/katex/LICENSE`
- License: MIT
- Copyright notice: Copyright (c) 2013-2020 Khan Academy and other
  contributors.
- Changes: none.

### VS Code Codicons

- Package: `@vscode/codicons`
- Version: 0.0.45
- Source: `https://github.com/microsoft/vscode-codicons`
- Bundled files: `media/vendor/codicons/codicon.css`,
  `media/vendor/codicons/codicon.ttf`,
  `media/vendor/licenses/codicons/LICENSE`,
  `media/vendor/licenses/codicons/LICENSE-CODE`
- License: icon/font assets under Creative Commons Attribution 4.0
  International; package code under MIT.
- Attribution: Codicons by Microsoft Corporation.
- Changes: none.

## Development Tooling

The following tools are development-only and are not bundled into the VSIX:

- `@playwright/test` 1.60.0, Apache-2.0, used for webview UI smoke testing.
- `@vscode/test-electron`, `@vscode/vsce`, TypeScript, and Node type packages,
  used for build, extension-host smoke testing, and packaging.

## MIT License Text

The MIT License applies to Hackl and to the bundled MIT-licensed third-party
runtime assets listed above where noted:

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
