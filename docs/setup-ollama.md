# Set up Hackl with Ollama

Ollama is an alternative if you already use it. It exposes an OpenAI-compatible
endpoint, but model-name conventions and a few API quirks differ from
LM Studio and llama.cpp. Hackl works, but expect minor friction (no
`/props`, slightly different completion shape on older Ollama versions).

For most users we recommend LM Studio (easy) or llama.cpp (control). Use
Ollama if it's already part of your stack.

## 1. Install and start Ollama

See <https://ollama.com/download> for installers. Then:

```sh
ollama serve
```

The default OpenAI-compatible base URL is:

```
http://127.0.0.1:11434/v1
```

## 2. Pull a chat model tier

Three chat/edit/agent tiers, each with a Qwen pick and a Gemma alternative.

| Tier | RAM/VRAM | Qwen (default) | Gemma alternative |
| ---- | -------- | -------------- | ----------------- |
| S    | 4-8 GB   | `qwen3:4b`     | `gemma3n:e2b`     |
| M    | 12-16 GB | `qwen3:8b`     | `gemma3n:e4b`     |
| L    | 24 GB+   | `qwen3-coder:30b` (MoE) | `gemma3:12b` (27b if >=30 GB) |

```sh
# Tier S
ollama pull qwen3:4b
ollama pull gemma3n:e2b

# Tier M
ollama pull qwen3:8b
ollama pull gemma3n:e4b

# Tier L
ollama pull qwen3-coder:30b
ollama pull gemma3:12b
```

Use whatever `ollama list` shows as the model id when talking to the API.

## 3. Point Hackl at it

Either click **Set endpoint to :11434/v1** in the Hackl setup panel, or:

```jsonc
// settings.json
{
  "hackl.endpoint": "http://localhost:11434/v1",
  "hackl.maxContextTokens": 32768
}
```

Run `Hackl: Check Local Server` to confirm.

Inline autocomplete currently expects llama.cpp-native `/tokenize` plus
`/infill` or `/completion`. Keep Ollama for chat if you prefer it, and run a
separate llama.cpp FIM endpoint for autocomplete:

```jsonc
{
  "hackl.endpoint": "http://localhost:11434/v1",
  "hackl.autocomplete.enabled": true,
  "hackl.autocomplete.endpoint": "http://localhost:8084/v1",
  "hackl.autocomplete.model": "qwenfim"
}
```

## Sources

- Ollama OpenAI compatibility: <https://github.com/ollama/ollama/blob/main/docs/openai.md>
- Ollama model library: <https://ollama.com/library>
