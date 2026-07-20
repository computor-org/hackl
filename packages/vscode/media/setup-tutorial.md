# Start Hackl in two steps

1. Start a model:

   - **Hackl Engine**: choose, download, and start a suitable llama.cpp model.
   - **LM Studio**: download a model and click *Start Server*.
   - **Existing llama.cpp**: `llama-server -m model.gguf --port 8080`.
   - **Ollama**: `ollama serve`.

2. Run **Hackl: Configure Primary Endpoint and Model**. Enter the server address;
   `/v1` is optional. Pick the model Hackl discovers.

That is enough for Qwen on llama.cpp or a compatible gateway: chat and inline autocomplete
reuse the same endpoint and model. The separate autocomplete endpoint/model are
advanced overrides for a genuinely different FIM server.
