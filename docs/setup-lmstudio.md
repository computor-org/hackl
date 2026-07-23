# LM Studio setup

Use LM Studio when you want a desktop UI for model download, GPU selection,
server controls, and logs.

1. Install LM Studio from <https://lmstudio.ai/>.
2. Download and load a GGUF instruct model suited to your available memory.
   Qwen is a good coding default.
3. Open **Developer** or **Local Server** and start the server on loopback.
4. In VS Code, run **Hackl: Configure Primary Endpoint and Model** and enter:

   ```text
   http://127.0.0.1:1234/v1
   ```

   You may also set:

   ```jsonc
   {
     "hackl.endpoint": "http://127.0.0.1:1234/v1"
   }
   ```

Run **Hackl: Check Local Server** to verify the connection. Setting an endpoint
disables managed llama.cpp startup for that VS Code window.

LM Studio supports Hackl chat, edits, agent work, and review. It does not expose
the llama.cpp-native `/infill` or `/completion` routes used for inline
autocomplete. For completion, run a small llama.cpp server separately:

```jsonc
{
  "hackl.autocomplete.endpoint": "http://127.0.0.1:8084/v1"
}
```

Keep LM Studio bound to `127.0.0.1` unless you have deliberately secured remote
access.

LM Studio OpenAI compatibility:
<https://lmstudio.ai/docs/developer/openai-compat>
