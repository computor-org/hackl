# Hackl local model

Hackl runs a curated open-weights model on your machine via llama.cpp.

- Hardware-aware setup tunes context size and GPU offload automatically.
- KV cache is held in Q8 to make long contexts affordable.
- All inference stays on `127.0.0.1` — no telemetry, no cloud.
