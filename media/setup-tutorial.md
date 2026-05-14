# Connect Hackl to your local model

Hackl does not run a model. It speaks OpenAI-compatible HTTP to whatever
server you have running on `127.0.0.1`. Pick one of these paths:

- **LM Studio** — easiest. Download a model and click *Start Server*.
- **llama.cpp** — most control. `llama-server -m model.gguf --port 8080`.
- **Ollama** — alternative. `ollama serve`.
