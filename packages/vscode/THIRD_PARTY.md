# Third-Party Provenance

Hackl is MIT licensed. See `LICENSE`.

Hackl is not a fork of `ggml-org/llama.vscode`.

The initial design was informed by public inspection of:

- `ggml-org/llama.vscode`, MIT license, especially its VS Code local-LLM
  extension surface, `/infill` support, and OpenAI-compatible endpoint handling.

No source code has been copied from `llama.vscode` in the initial scaffold.
If future commits copy or closely adapt code, record the copied files, upstream
commit, copyright notice, and MIT license text here.

## Bundled Runtime Dependencies

`dist/extension.js` is an esbuild bundle. esbuild inlines the
`@modelcontextprotocol/sdk` client and its reachable transitive dependencies
into the single file, so the VSIX contains the code below. The SDK's
server-side dependencies (`express`, `hono`, `cors`, `jose`, and others) are not
reachable from the extension's client code and are not bundled. The ISC and
BSD-3-Clause texts that govern three of these packages follow the MIT text at
the end of this file.

| Package | Version | License | Copyright |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.29.0 | MIT | Copyright (c) 2024 Anthropic, PBC |
| `ajv` | 8.20.0 | MIT | Copyright (c) 2015-2021 Evgeny Poberezkin |
| `ajv-formats` | 3.0.1 | MIT | Copyright (c) 2020 Evgeny Poberezkin |
| `cross-spawn` | 7.0.6 | MIT | Copyright (c) 2018 Made With MOXY Lda |
| `eventsource` | 3.0.7 | MIT | Copyright (c) EventSource GitHub organisation |
| `eventsource-parser` | 3.1.0 | MIT | Copyright (c) 2026 Espen Hovlandsdal |
| `fast-deep-equal` | 3.1.3 | MIT | Copyright (c) 2017 Evgeny Poberezkin |
| `fast-uri` | 3.1.2 | BSD-3-Clause | Copyright (c) 2011-2021 Gary Court; Copyright (c) 2021-present The Fastify team |
| `isexe` | 2.0.0 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| `json-schema-traverse` | 1.0.0 | MIT | Copyright (c) 2017 Evgeny Poberezkin |
| `path-key` | 3.1.1 | MIT | Copyright (c) Sindre Sorhus |
| `pkce-challenge` | 5.0.1 | MIT | Copyright (c) 2019 (holder unspecified upstream) |
| `shebang-command` | 2.0.0 | MIT | Copyright (c) Kevin Mårtensson |
| `shebang-regex` | 3.0.0 | MIT | Copyright (c) Sindre Sorhus |
| `which` | 2.0.2 | ISC | Copyright (c) Isaac Z. Schlueter and Contributors |
| `zod` | 4.4.3 | MIT | Copyright (c) 2025 Colin McDonnell |
| `zod-to-json-schema` | 3.25.2 | ISC | Copyright (c) 2020 Stefan Terdell |

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

## License Texts

### MIT License

The MIT License applies to Hackl and to the bundled MIT-licensed third-party
runtime assets and dependencies listed above where noted:

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

### ISC License

Applies to `isexe`, `which`, and `zod-to-json-schema`.

```text
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR
IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### BSD-3-Clause License

Applies to `fast-uri`.

```text
Copyright (c) 2011-2021, Gary Court
Copyright (c) 2021-present The Fastify team <https://github.com/fastify/fastify#team>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * The names of any contributors may not be used to endorse or promote
      products derived from this software without specific prior written
      permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDERS AND CONTRIBUTORS BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
