# Set up Hackl with LM Studio

LM Studio is the easiest path: it handles model discovery, download, GPU
offload, server start/stop, and logs through a desktop GUI. Hackl just talks
to the OpenAI-compatible HTTP endpoint it exposes.

## 1. Install LM Studio

Install for Windows, macOS, or Linux from <https://lmstudio.ai/>. Open it once.

## 2. Pick a model tier

Three tiers, each with a Qwen pick and a Gemma alternative. Numbers are rough;
your mileage varies with quantisation, context length, and GPU/CPU split.

| Tier | RAM/VRAM | Qwen (default)             | Gemma alternative          |
| ---- | -------- | -------------------------- | -------------------------- |
| S    | 4–8 GB   | `Qwen3-4B-Instruct-GGUF` Q4_K_M | `gemma-3n-E2B-it-GGUF` Q4_0 |
| M    | 12–16 GB | `Qwen3-8B-GGUF` Q4_K_M     | `gemma-3n-E4B-it-GGUF` Q4_0 |
| L    | 24 GB+   | `Qwen3-14B-GGUF` Q4_K_M (or `Qwen3-30B-A3B-GGUF` Q4_K_M for MoE) | `gemma-3-12b-it-GGUF` Q4_K_M (or `gemma-3-27b-it-GGUF` if you have ~30 GB) |

In the LM Studio search bar, paste one of the names above, pick a matching GGUF
publisher, and download. Load it and confirm a quick chat in LM Studio's own UI.

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
  "hackl.maxContextTokens": 32768
}
```

Run `Hackl: Check Local Server` to confirm.

## Notes

- LM Studio's OpenAI compatibility docs:
  <https://lmstudio.ai/docs/developer/openai-compat>
- Editor chat is comfortable at 16k–32k context. Agentic coding wants 64k+ if
  your RAM/VRAM allows it.
- Gemma 3n's E2B/E4B are "effective" parameter sizes — actual memory footprint
  is smaller than a vanilla 4B/8B model; the E4B fits where an 8B Qwen would
  struggle.
