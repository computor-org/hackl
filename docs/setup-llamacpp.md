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

## 2. Start a server

Small model (~6 GB VRAM, 9B Q4_K_M):

```sh
llama-server \
  -hf bartowski/Qwen_Qwen3.5-9B-GGUF:Q4_K_M \
  -c 32768 \
  --cache-type-k q8_0 \
  --cache-type-v q8_0 \
  -ngl auto \
  -fa on \
  --alias qwen-local \
  --jinja \
  --host 127.0.0.1 \
  --port 8080
```

Large agentic model (~22 GB weights, 35B-A3B):

```sh
llama-server \
  -hf unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_XL \
  -c 65536 \
  --cache-type-k q8_0 \
  --cache-type-v q8_0 \
  -ngl auto \
  -fa on \
  --alias qwen-local \
  --jinja \
  --host 127.0.0.1 \
  --port 8080
```

Web UI: <http://127.0.0.1:8080/>.

## 3. Point Hackl at it

Either click **Set endpoint to :8080/v1** in the Hackl setup view, or:

```jsonc
// settings.json
{
  "hackl.endpoint": "http://localhost:8080/v1",
  "hackl.maxContextTokens": 32768
}
```

Run `Hackl: Check Local Server` to confirm.

## Tuning notes

- Lower `-c` if the model does not fit; raise toward 64k or 128k only after
  the model is stable.
- `q8_0` KV cache is a good long-context compromise.
- `-ngl auto` asks llama.cpp to place what fits on GPU.
- On MoE models, partial CPU expert placement with `--n-cpu-moe N` can help
  fit limited VRAM; tune `N` per hardware.
- `--no-webui` disables the browser UI.

## Sources

- llama.cpp server: <https://github.com/ggml-org/llama.cpp/tree/master/tools/server>
- Qwen on llama.cpp: <https://qwen.readthedocs.io/en/latest/run_locally/llama.cpp.html>
