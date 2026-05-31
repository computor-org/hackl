# Set up Hackl with LM Studio

LM Studio is the easiest path: it handles model discovery, download, GPU
offload, server start/stop, and logs through a desktop GUI. Hackl just talks
to the OpenAI-compatible HTTP endpoint it exposes.

## 1. Install LM Studio

Install for Windows, macOS, or Linux from <https://lmstudio.ai/>. Open it once.

## 2. Pick a chat model tier

Three chat/edit/agent tiers, each with a Qwen pick and a Gemma alternative.
Numbers are rough; your mileage varies with quantisation, context length, and
GPU/CPU split.

| Tier | RAM/VRAM | Qwen (default)             | Gemma alternative          |
| ---- | -------- | -------------------------- | -------------------------- |
| S    | 4-8 GB   | `Qwen3-4B-Instruct-GGUF` Q4_K_M | `gemma-3n-E2B-it-GGUF` Q4_0 |
| M    | 12-16 GB | `Qwen3-8B-GGUF` Q4_K_M     | `gemma-3n-E4B-it-GGUF` Q4_0 |
| L    | 24 GB+   | `Qwen3-Coder-30B-A3B-Instruct-GGUF` Q4_K_M (or `Qwen3-14B-GGUF` Q4_K_M) | `gemma-3-12b-it-GGUF` Q4_K_M (or `gemma-3-27b-it-GGUF` if you have ~30 GB) |

In the LM Studio search bar, paste one of the names above, pick a matching GGUF
publisher, and download. Load it and confirm a quick chat in LM Studio's own UI.

For inline autocomplete, prefer a FIM model on a second local server:

| Tier | FIM model |
| ---- | --------- |
| S | `Qwen2.5-Coder-1.5B-Instruct-GGUF` or `Qwen2.5-Coder-3B-Instruct-GGUF` Q4_K_M |
| M | `Qwen2.5-Coder-7B-Instruct-GGUF` Q4_K_M |
| L | `Qwen2.5-Coder-14B-Instruct-GGUF` or `Qwen3-Coder-30B-A3B-Instruct-GGUF` Q4_K_M |
| XL | `Qwen3-Coder-Next-GGUF` Q4_K_M |

FIM needs a Coder model with infill tokens; a general chat model (Qwen3.5/3.6,
Gemma) cannot do it. On a single 32 GB machine, pair them: chat/agent on a
35B-A3B MoE (such as Qwen3.6 35B-A3B at IQ4) and FIM on Qwen2.5-Coder 7B. LM
Studio serves one model at a time, so keep chat in LM Studio and run the FIM
model on a separate llama.cpp server (see the llama.cpp guide). Both fit because
the chat KV is small and the FIM window is tiny. Avoid a large dense Coder such
as Codestral 22B in the FIM slot on a laptop: every token activates all weights,
too slow for inline completion.

## 3. Start the local server

In LM Studio, open the **Developer** (or **Local Server**) tab and start the
server. The default base URL is:

```
http://127.0.0.1:1234/v1
```

Keep it bound to `127.0.0.1`. Optional: enable "run on login" in LM Studio
settings if you want it always up.

## 4. Point Hackl at it

Either click **Set endpoint to :1234/v1** in the Hackl setup panel, or edit:

```jsonc
// settings.json
{
  "hackl.endpoint": "http://localhost:1234/v1",
  "hackl.maxContextTokens": 32768,
  "hackl.autocomplete.enabled": true,
  "hackl.autocomplete.endpoint": "http://localhost:8084/v1",
  "hackl.autocomplete.model": "qwenfim"
}
```

Run `Hackl: Check Local Server` to confirm.

## Notes

- LM Studio's OpenAI compatibility docs:
  <https://lmstudio.ai/docs/developer/openai-compat>
- Editor chat is comfortable at 16k-32k context. Agentic coding wants 64k+ if
  your RAM/VRAM allows it.
- If LM Studio serves only one model at a time, use llama.cpp for the dedicated
  FIM autocomplete endpoint.
- Gemma 3n's E2B/E4B are "effective" parameter sizes. Actual memory footprint
  is smaller than a vanilla 4B/8B model; the E4B fits where an 8B Qwen would
  struggle.
