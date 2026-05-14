# Set up Hackl with Ollama

Ollama is an alternative if you already use it. It exposes an OpenAI-compatible
endpoint, but model-name conventions and a few API quirks differ from
LM Studio and llama.cpp — Hackl works, but expect minor friction (no
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

```sh
ollama pull qwen3:8b
# or
ollama pull qwen3-coder:30b
```

Ollama model names have their own namespace. Use whatever `ollama list` shows
as the model id when talking to the API.

## 3. Point Hackl at it

Either click **Set endpoint to :11434/v1** in the Hackl setup view, or:

```jsonc
// settings.json
{
  "hackl.endpoint": "http://localhost:11434/v1",
  "hackl.maxContextTokens": 32768
}
```

Run `Hackl: Check Local Server` to confirm.

## Sources

- Ollama OpenAI compatibility: <https://github.com/ollama/ollama/blob/main/docs/openai.md>
