# Third-Party Notices

Hackl is MIT licensed. See [`LICENSE`](LICENSE).

This file records third-party material distributed with Hackl and the
provenance of the project. It is the canonical notice for the monorepo. The
VS Code extension ships its own copy at
[`packages/vscode/THIRD_PARTY.md`](packages/vscode/THIRD_PARTY.md) so the VSIX
is self-contained.

## Provenance

Hackl is not a fork of `ggml-org/llama.vscode`.

The initial design was informed by public inspection of `ggml-org/llama.vscode`
(MIT), especially its VS Code local-LLM extension surface, `/infill` support,
and OpenAI-compatible endpoint handling. No source code has been copied from
`llama.vscode`. If a future commit copies or closely adapts code, record the
copied files, the upstream commit, the copyright notice, and the MIT license
text here and in the copied file's header.

## Bundled runtime dependencies

The CLI (`packages/cli/dist/index.js`), the GUI server (`packages/server/dist/cli.js`,
bin `hackl-serve`), and the VS Code extension (`packages/vscode/dist/extension.js`)
are esbuild bundles. esbuild inlines the `@modelcontextprotocol/sdk` client and
its reachable transitive dependencies into each single-file artifact, so the
shipped binary contains the code below. The list is the set esbuild actually
inlines after tree-shaking; the SDK's server-side dependencies (`express`,
`hono`, `cors`, `jose`, and others) are not reachable from Hackl's client code
and are not bundled. `ws` is bundled into the GUI server only.

| Package | Version | License | Copyright |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk` | 1.29.0 | MIT | Copyright (c) 2024 Anthropic, PBC |
| `ws` | 8.21.0 | MIT | Copyright (c) 2011 Einar Otto Stangvik and contributors (Arnout Kazemier; Luigi Pinca) |
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

The MIT, ISC, and BSD-3-Clause license texts that govern these packages are
reproduced under [License texts](#license-texts).

## Desktop application

The desktop app (`@hackl/desktop`) is an Electron shell. Its main process is an
esbuild bundle that inlines `@hackl/server` and the runtime dependencies listed
above (`@modelcontextprotocol/sdk`, `ws`, and their transitive deps); `electron`
is provided by the runtime, not bundled by esbuild. The packaged binary embeds
Electron (MIT) and Chromium, which ship their own component license manifest
(`LICENSES.chromium.html`) inside the app. Electron and electron-builder are
build-time tools resolved only by the desktop release job; they are not part of
the npm install for the other packages.

## Managed llama.cpp engine (downloaded on request, not bundled)

`hackl up` can download a llama.cpp prebuilt release from `ggml-org/llama.cpp`
(MIT) for the host platform, pinned by tag and verified against an in-repo
sha256 table. The binary is cached under the user's home, not bundled into any
hackl artifact, so it is not redistributed by hackl. Model weights (GGUF) are
downloaded from Hugging Face at the user's request and carry their own licenses
(e.g. Apache-2.0 for Qwen and gpt-oss, the Gemma license for Gemma); hackl does
not redistribute them. The launch defaults derive from the maintainer's own
infrastructure conventions.

## Bundled webview assets (VS Code extension only)

The VSIX bundles these assets for the chat webview. They load from the
extension package, not a network CDN. License files ship at
`packages/vscode/media/vendor/licenses/<asset>/`.

### markdown-it

- Version: 14.1.1
- Source: https://github.com/markdown-it/markdown-it
- License: MIT
- Copyright (c) 2014 Vitaly Puzrin, Alex Kocharin
- Changes: none

### KaTeX

- Version: 0.16.45
- Source: https://github.com/KaTeX/KaTeX
- License: MIT
- Copyright (c) 2013-2020 Khan Academy and other contributors
- Changes: none

### VS Code Codicons

- Version: 0.0.45
- Source: https://github.com/microsoft/vscode-codicons
- License: icon and font assets under CC BY 4.0; package code under MIT
- Codicons by Microsoft Corporation
- Changes: none

## Development tooling

These tools build, test, and package Hackl. They are not bundled into the CLI
or the VSIX.

- `esbuild` 0.24.2, MIT
- `typescript` 5.9.3, Apache-2.0
- `ws` (bundled into the GUI server, listed above), MIT
- `@types/node`, `@types/vscode`, MIT
- `@vscode/vsce`, `@vscode/test-electron`, MIT
- `@playwright/test` 1.60.0, Apache-2.0 (webview UI smoke testing)
- `katex`, `markdown-it`, `@vscode/codicons` (also vendored into the VSIX, above)

## License texts

### MIT License

Applies to Hackl and to the MIT-licensed packages listed above. The copyright
holder of each package is named in the table; the permission and warranty terms
are identical.

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

### Apache-2.0

`typescript` and `@playwright/test` are licensed under Apache-2.0, a
development-only dependency not redistributed in the bundles. Full text:
https://www.apache.org/licenses/LICENSE-2.0
