# Ollama setup

Use Ollama when it is already your local model runtime.

1. Install it from <https://ollama.com/download>.
2. Start it and pull a coding model:

   ```sh
   ollama serve
   ollama pull qwen3.5:9b
   ```

3. In VS Code, run **Hackl: Configure Primary Endpoint and Model** with:

   ```text
   http://127.0.0.1:11434/v1
   ```

   Or configure it directly:

   ```jsonc
   {
     "hackl.endpoint": "http://127.0.0.1:11434/v1",
     "hackl.model": "qwen3.5:9b"
   }
   ```

Use the exact model ID shown by `ollama list`. Run **Hackl: Check Local Server**
to verify the connection.

Ollama supports chat, edits, agent work, and review. It does not expose the llama.cpp-native
completion routes used for inline autocomplete; configure a separate
llama.cpp server if needed:

```jsonc
{
  "hackl.autocomplete.endpoint": "http://127.0.0.1:8084/v1"
}
```

Ollama OpenAI compatibility:
<https://github.com/ollama/ollama/blob/main/docs/openai.md>
