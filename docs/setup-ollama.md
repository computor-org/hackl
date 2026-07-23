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

## 2. Pull a model

Pick one model by the memory you have. The same model drives chat, edit, and
agent modes.

| Tier | RAM/VRAM | Qwen | Gemma (chat only) |
| ---- | -------- | ---- | ----------------- |
| S    | 4-8 GB   | `qwen3.5:4b`     | `gemma4:e2b` |
| M    | 12-16 GB | `qwen3.5:9b`     | `gemma4:e4b` |
| L    | 24-32 GB | `qwen3.6:35b-a3b` | `gemma4:26b` (MoE) |

```sh
ollama pull qwen3.5:4b       # Tier S
ollama pull qwen3.5:9b       # Tier M
ollama pull qwen3.6:35b-a3b  # Tier L
```

Gemma carries no infill tokens, so it does chat but not autocomplete. Since
Ollama does not serve `/infill` either, autocomplete needs a llama.cpp server
regardless (see below).

Use whatever `ollama list` shows as the model id when talking to the API.

## 3. Point Hackl at it

Hackl probes the common local ports on its own. To pin it, set the endpoint in settings:

```jsonc
// settings.json
{
  "hackl.endpoint": "http://localhost:11434/v1",
  "hackl.maxContextTokens": 32768
}
```

Run `Hackl: Check Local Server` to confirm. Hackl ships with thinking off, so an
agent run will not loop; turn it on only with a server that bounds reasoning.

## Inline autocomplete

Inline completion uses llama.cpp-native `/tokenize` plus `/infill` or
`/completion`, which Ollama does not serve. Keep Ollama for chat and run a small
llama.cpp server for autocomplete (see the llama.cpp guide's Advanced section):

```jsonc
{
  "hackl.endpoint": "http://localhost:11434/v1",
  "hackl.autocomplete.enabled": true,
  "hackl.autocomplete.endpoint": "http://localhost:8084/v1"
}
```

## Hackl and Ollama

Hackl detects and adopts a running Ollama server read-only on its default port:
it uses the server but never starts, stops, or manages Ollama. The hackl-managed
local engine (`hackl serve`, model recommendation, knobs) targets llama.cpp only;
see [`setup-llamacpp.md`](setup-llamacpp.md).

## Sources

- Ollama OpenAI compatibility: <https://github.com/ollama/ollama/blob/main/docs/openai.md>
- Ollama model library: <https://ollama.com/library>
