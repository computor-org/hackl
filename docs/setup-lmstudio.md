# Set up Hackl with LM Studio

LM Studio is the easiest path: it handles model discovery, download, GPU
offload, server start/stop, and logs through a desktop GUI. Hackl just talks
to the OpenAI-compatible HTTP endpoint it exposes.

## 1. Install LM Studio

Install for Windows, macOS, or Linux from <https://lmstudio.ai/>. Open it once.

## 2. Pick a model

Pick one model by the memory you have. The same model drives chat, edit, and
agent modes.

| Tier | RAM/VRAM | Qwen (chat + autocomplete) | Gemma (chat only) |
| ---- | -------- | -------------------------- | ----------------- |
| S    | 4-8 GB   | `Qwen3.5-4B-GGUF` Q4_K_M | `gemma-4-E2B-it-GGUF` Q4_K_M |
| M    | 12-16 GB | `Qwen3.5-9B-GGUF` Q4_K_M | `gemma-4-E4B-it-GGUF` Q4_K_M |
| L    | 24-32 GB | `Qwen3.6-35B-A3B-MTP-GGUF` Q4_K_M | `gemma-4-26B-A4B-it-GGUF` Q4_K_M |

Gemma carries no infill tokens, so it does chat, edit, and agent but not inline
autocomplete. Choose Qwen if you want completion.

In the LM Studio search bar, paste one of the names above, pick a matching GGUF
publisher, and download. Load it and confirm a quick chat in LM Studio's own UI.

In the model's settings, set the Qwen "thinking + precise coding" sampler:
temperature 0.6, top-p 0.95, top-k 20, min-p 0. Hackl ships with thinking off,
so an agent run will not loop. If you turn thinking on, use LM Studio's own
reasoning controls to bound it.

## 3. Start the local server

In LM Studio, open the **Developer** (or **Local Server**) tab and start the
server. The default base URL is:

```
http://127.0.0.1:1234/v1
```

Keep it bound to `127.0.0.1`. Optional: enable "run on login" in LM Studio
settings if you want it always up.

## 4. Point Hackl at it

Hackl probes the common local ports on its own. To pin it, set the endpoint in settings:

```jsonc
// settings.json
{
  "hackl.endpoint": "http://localhost:1234/v1",
  "hackl.maxContextTokens": 32768
}
```

Run `Hackl: Check Local Server` to confirm.

## Inline autocomplete

Inline completion uses llama.cpp-native `/infill` and `/tokenize`, which LM
Studio does not serve. Chat, edit, and agent modes work against LM Studio; for
autocomplete, run a small llama.cpp server alongside and point Hackl's
autocomplete endpoint at it. See the llama.cpp guide's Advanced section, then:

```jsonc
{
  "hackl.endpoint": "http://localhost:1234/v1",
  "hackl.autocomplete.enabled": true,
  "hackl.autocomplete.endpoint": "http://localhost:8084/v1"
}
```

## Notes

- LM Studio's OpenAI compatibility docs:
  <https://lmstudio.ai/docs/developer/openai-compat>
- Editor chat is comfortable at 16k-32k context. Agentic coding wants 64k+ if
  your RAM/VRAM allows it.
- The 35B-A3B is a mixture-of-experts model: about 3B parameters are active per
  token, so it decodes far faster than its size suggests and fits a 32 GB box.
- Hackl adopts a running LM Studio server read-only (it uses it, never manages
  it). The Hackl-managed session (`hackl serve`) targets llama.cpp; see
  [`setup-llamacpp.md`](setup-llamacpp.md).
