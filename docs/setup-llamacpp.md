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

## 2. Pick a chat model tier and start a server

Three chat/edit/agent tiers, each with a Qwen pick and a Gemma alternative.
Numbers are rough; your mileage varies with quantisation, context length, and
GPU/CPU split.

| Tier | RAM/VRAM | Qwen (default) | Gemma alternative |
| ---- | -------- | -------------- | ----------------- |
| S    | 4-8 GB   | Qwen3 4B-Instruct | Gemma 3n E2B-it |
| M    | 12-16 GB | Qwen3 8B          | Gemma 3n E4B-it |
| L    | 24 GB+   | Qwen3-Coder 30B-A3B, or Qwen3 14B | Gemma 3 12B-it (27B-it if >=30 GB) |

### Tier S (4-8 GB)

```sh
llama-server \
  -hf bartowski/Qwen_Qwen3-4B-Instruct-GGUF:Q4_K_M \
  -c 16384 \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  -ngl auto -fa on \
  --alias qwen-local --jinja \
  --host 127.0.0.1 --port 8080
```

Gemma alternative:

```sh
llama-server \
  -hf ggml-org/gemma-3n-E2B-it-GGUF:Q4_0 \
  -c 16384 \
  -ngl auto -fa on \
  --alias gemma-local --jinja \
  --host 127.0.0.1 --port 8080
```

### Tier M (12-16 GB)

```sh
llama-server \
  -hf bartowski/Qwen_Qwen3-8B-GGUF:Q4_K_M \
  -c 32768 \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  -ngl auto -fa on \
  --alias qwen-local --jinja \
  --host 127.0.0.1 --port 8080
```

Gemma alternative:

```sh
llama-server \
  -hf ggml-org/gemma-3n-E4B-it-GGUF:Q4_0 \
  -c 32768 \
  -ngl auto -fa on \
  --alias gemma-local --jinja \
  --host 127.0.0.1 --port 8080
```

### Tier L (24 GB+)

```sh
llama-server \
  -hf lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q4_K_M \
  -c 65536 \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  -ngl auto -fa on \
  --alias qwen-local --jinja \
  --host 127.0.0.1 --port 8080
```

Gemma alternative (12B fits ~12 GB VRAM; 27B fits ~22 GB VRAM at Q4):

```sh
llama-server \
  -hf bartowski/gemma-3-12b-it-GGUF:Q4_K_M \
  -c 32768 \
  -ngl auto -fa on \
  --alias gemma-local --jinja \
  --host 127.0.0.1 --port 8080
```

Web UI: <http://127.0.0.1:8080/>.

## 3. Optional FIM autocomplete endpoint

Hackl can use the chat endpoint for autocomplete only when that local model has
FIM tokens. For the best local UX, run a second low-latency FIM endpoint on a
different port and point `hackl.autocomplete.endpoint` at it.

| Tier | RAM/VRAM | FIM model |
| ---- | -------- | --------- |
| S    | 4-8 GB   | Qwen2.5-Coder 1.5B or 3B Q4_K_M |
| M    | 12-16 GB | Qwen2.5-Coder 7B Q4_K_M |
| L    | 24 GB+   | Qwen2.5-Coder 14B or Qwen3-Coder 30B-A3B Q4_K_M |
| XL   | 64 GB+   | Qwen3-Coder-Next Q4_K_M |

FIM needs a Coder model with infill tokens. A general chat model (Qwen3.5/3.6,
Gemma) cannot drive autocomplete, so the FIM slot is always a Coder.

On a single 32 GB machine, run chat and FIM together: the chat server on `:8080`
(a 35B-A3B MoE such as Qwen3.6 35B-A3B at IQ4 for headroom) and the Tier M FIM
server below on `:8084`. Both fit because the 35B-A3B is hybrid-attention with a
small KV and the FIM window is tiny. Do not use a large dense Coder such as
Codestral 22B for FIM on a laptop: every token activates all weights, too slow
for inline completion.

Tier M autocomplete server:

```sh
llama-server \
  -hf Qwen/Qwen2.5-Coder-7B-Instruct-GGUF:Q4_K_M \
  -c 32768 \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  -ngl auto -fa on \
  --alias qwenfim --jinja \
  --temp 0.15 --top-p 0.9 --top-k 40 \
  --host 127.0.0.1 --port 8084
```

Server-class autocomplete endpoint:

```sh
llama-server \
  -hf Qwen/Qwen3-Coder-Next-GGUF:Q4_K_M \
  -c 131072 \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  -ngl auto -fa on -np 4 \
  --alias qwenfim --jinja \
  --temp 0.15 --top-p 0.9 --top-k 40 \
  --host 127.0.0.1 --port 8084
```

## 4. Point Hackl at it

Either click **Set endpoint to :8080/v1** in the Hackl setup panel, or:

```jsonc
// settings.json
{
  "hackl.endpoint": "http://localhost:8080/v1",
  "hackl.maxContextTokens": 32768,
  "hackl.autocomplete.enabled": true,
  "hackl.autocomplete.endpoint": "http://localhost:8084/v1",
  "hackl.autocomplete.model": "qwenfim"
}
```

Run `Hackl: Check Local Server` to confirm.

## Tuning notes

- Lower `-c` if the model does not fit; raise toward 64k or 128k only after the
  model is stable.
- `q8_0` KV cache is a good long-context compromise.
- `-ngl auto` asks llama.cpp to place what fits on GPU.
- On MoE models (e.g. Qwen3-30B-A3B), partial CPU expert placement with
  `--n-cpu-moe N` can help fit limited VRAM; tune `N` per hardware.
- `--no-webui` disables the browser UI.

## Sources

- llama.cpp server: <https://github.com/ggml-org/llama.cpp/tree/master/tools/server>
- Qwen on llama.cpp: <https://qwen.readthedocs.io/en/latest/run_locally/llama.cpp.html>
- Qwen3-Coder FIM: <https://github.com/QwenLM/Qwen3-Coder>
- Qwen2.5-Coder GGUF: <https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF>
- Qwen3-Coder-Next GGUF: <https://huggingface.co/Qwen/Qwen3-Coder-Next-GGUF>
- Gemma 3n: <https://ai.google.dev/gemma/docs/gemma-3n>
