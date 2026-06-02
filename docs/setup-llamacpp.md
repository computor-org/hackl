# Set up Hackl with llama.cpp

llama.cpp is the right path when you want a scriptable, reproducible local
server with minimal dependencies and no desktop app. MIT-licensed, fully open
source, OpenAI-compatible HTTP on a configurable port.

## 1. Install llama.cpp

macOS:

```sh
brew install llama.cpp
```

Windows:

```powershell
winget install llama.cpp
```

Linux:

Download the latest release for your platform from
<https://github.com/ggml-org/llama.cpp/releases> or build from source.

## 2. Pick a model and start a server

One Qwen model serves both chat and inline autocomplete. The Qwen line ships
the infill tokens (`<|fim_prefix|>`, `<|fim_suffix|>`, `<|fim_middle|>`), so the
same server answers chat through `/v1/chat/completions` and completes code
through `/infill`. Pick by the memory you have:

| Tier | RAM/VRAM | Qwen (chat + autocomplete) | Gemma (chat only) |
| ---- | -------- | -------------------------- | ----------------- |
| S    | 4-8 GB   | `Qwen3.5 4B`     | `Gemma 4 E2B` |
| M    | 12-16 GB | `Qwen3.5 9B`     | `Gemma 4 E4B` |
| L    | 24-32 GB | `Qwen3.6 35B-A3B` (MoE) | `Gemma 4 26B-A4B` (MoE) |

Gemma carries no infill tokens, so it drives chat, edit, and agent modes but not
inline autocomplete. Choose Qwen if you want completion.

Every command uses Qwen's "thinking + precise coding" sampler and caps hidden
reasoning at 4096 tokens. The cap matters: without it a thinking model loops
through the whole turn in an agent run. `--reasoning-format deepseek` splits the
`<think>` block into a separate `reasoning_content` field so the client renders
a clean answer.

Tier S:

```sh
llama-server \
  -hf bartowski/Qwen_Qwen3.5-4B-GGUF:Q4_K_M \
  -c 16384 --cache-type-k q8_0 --cache-type-v q8_0 \
  -ngl auto -fa on --alias qwen-local --jinja \
  --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0 \
  --presence-penalty 0.0 --repeat-penalty 1.0 \
  --reasoning-format deepseek --reasoning-budget 4096 \
  --host 127.0.0.1 --port 8080
```

Tier M:

```sh
llama-server \
  -hf bartowski/Qwen_Qwen3.5-9B-GGUF:Q4_K_M \
  -c 32768 --cache-type-k q8_0 --cache-type-v q8_0 \
  -ngl auto -fa on --alias qwen-local --jinja \
  --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0 \
  --presence-penalty 0.0 --repeat-penalty 1.0 \
  --reasoning-format deepseek --reasoning-budget 4096 \
  --host 127.0.0.1 --port 8080
```

Tier L. The MTP build ships a multi-token prediction head; the `--spec-type
draft-mtp` flags draft and verify in parallel for faster decode. The 35B-A3B is
hybrid-attention, so its KV cache at 131072 context costs about the same as
32768:

```sh
llama-server \
  -hf unsloth/Qwen3.6-35B-A3B-MTP-GGUF:UD-Q4_K_XL \
  -c 131072 --cache-type-k q8_0 --cache-type-v q8_0 \
  -ngl auto -fa on --alias qwen-local --jinja \
  --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0 \
  --presence-penalty 0.0 --repeat-penalty 1.0 \
  --reasoning-format deepseek --reasoning-budget 4096 \
  --spec-type draft-mtp --spec-draft-n-max 2 \
  --cache-type-k-draft q8_0 --cache-type-v-draft q8_0 \
  --host 127.0.0.1 --port 8080
```

Gemma alternative (chat only, no autocomplete), sized per tier. Gemma 4 is a
thinking model, so it takes the same reasoning cap:

```sh
llama-server -hf unsloth/gemma-4-E4B-it-GGUF:Q4_K_M \
  -c 32768 -ngl auto -fa on --jinja \
  --reasoning-format deepseek --reasoning-budget 4096 \
  --host 127.0.0.1 --port 8080
```

Web UI: <http://127.0.0.1:8080/>.

## 3. Point Hackl at it

Either click **Set endpoint to :8080/v1** in the Hackl setup panel, or edit:

```jsonc
// settings.json
{
  "hackl.endpoint": "http://localhost:8080/v1",
  "hackl.maxContextTokens": 32768,
  "hackl.autocomplete.enabled": true
}
```

Leave `hackl.autocomplete.endpoint` empty: autocomplete reuses the chat model
through `/infill`, which skips the chat template and never enters a reasoning
phase. Run `Hackl: Check Local Server` to confirm.

## Advanced

A separate autocomplete endpoint and a smaller model both stay available; most
users need neither.

- **Tiny, faster FIM.** On a small box that wants quicker keystroke latency,
  serve `bartowski/Qwen_Qwen3.5-2B-GGUF:Q4_K_M` on a second port (`--port 8084`,
  `--alias qwenfim`) and set `hackl.autocomplete.endpoint` to
  `http://localhost:8084/v1`.
- **Reasoning budget.** The launch commands cap reasoning server-side with
  `--reasoning-budget 4096`. When the server runs without that flag (for example
  LM Studio or Ollama), Hackl sends the cap per request from
  `hackl.reasoningBudget` instead. `-1` is unrestricted, `0` ends thinking
  immediately.

## Tuning notes

- Lower `-c` if the model does not fit; raise toward 64k or 128k only after the
  model is stable.
- `q8_0` KV cache is a good long-context compromise.
- `-ngl auto` asks llama.cpp to place what fits on GPU.
- On the 35B-A3B MoE, partial CPU expert placement with `--n-cpu-moe N` can help
  fit limited VRAM; tune `N` per hardware.
- `--no-webui` disables the browser UI.

## Sources

- llama.cpp server: <https://github.com/ggml-org/llama.cpp/tree/master/tools/server>
- Qwen on llama.cpp: <https://qwen.readthedocs.io/en/latest/run_locally/llama.cpp.html>
- Qwen3.5 GGUF: <https://huggingface.co/bartowski/Qwen_Qwen3.5-9B-GGUF>
- Qwen3.6 35B-A3B MTP GGUF: <https://huggingface.co/unsloth/Qwen3.6-35B-A3B-MTP-GGUF>
