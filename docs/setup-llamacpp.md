# Set up Hackl with llama.cpp

llama.cpp is the right path when you want a scriptable, reproducible local
server with minimal dependencies and no desktop app. MIT-licensed, fully open
source, OpenAI-compatible HTTP on a configurable port.

## Managed setup (recommended)

hackl can install and run llama.cpp for you, sized to your machine:

```sh
hackl serve [model]          # foreground engine + Hackl and llama.cpp WebUIs
hackl models                 # catalog, recommendation, installed and active state
hackl models remove <model>  # remove a managed model file
```

`hackl serve` resolves a llama-server binary in this order: an existing install
(`LLAMACPP_HOME`, your PATH, `~/.local/llama.cpp`), a previous managed install,
then a **pinned, sha256-verified** ggml-org prebuilt for your platform. It then
downloads the chosen model into the shared cache (`~/.cache/llama.cpp`, the same
layout the manual path and slopcode-infra use) and starts the server bound to
`127.0.0.1`.

The explicit command remains in its terminal and Ctrl+C stops it. Ordinary
Hackl CLI, VS Code, and desktop clients instead share one temporary automatic
session. Clean clients release it immediately; crashed clients expire after
about ten seconds. The first starter owns the model and launch settings until
that session ends. Hackl installs no service, startup task, or tray process.

**Adoption.** If a llama.cpp (or other OpenAI-compatible) server is already
listening on 8080/8081/1234, hackl uses it read-only and never stops or restarts
it; only servers hackl started are managed. So a server you run by hand or via a
service keeps working unchanged.

**Model choice.** `hackl models` marks the largest catalog model that fits
your memory, from a 1.5B coder up to the Qwen3.6-35B-A3B MoE. Two rules: the
**35B-A3B MoE decodes faster than the dense 27B** (about 3B active params), so it
is preferred when it fits; and at **~16 GB, Qwen 9B is preferred over Gemma 12B**
(it fits better, ships FIM tokens, and is stronger at code). Pass an alias to
`hackl serve`; a successful explicit choice becomes the next default. If an
owner is already active, later clients must use its model.

**Knobs.** Defaults come from the hardware probe (context, n-cpu-moe split, KV
quant, threads, flash-attn). MTP speculative decode and the vision projector
(mmproj) are model- and RAM-aware. Advanced overrides persist in the `engine`
block of `~/.config/hackl/config.json`; they apply only when the next owner
starts.

The sections below cover the manual path if you prefer to run llama.cpp yourself;
hackl adopts that server automatically.

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

### gpt-oss-20b alternative (chat only, 16 GB)

OpenAI's gpt-oss-20b is a Mixture-of-Experts model (20.9B total, ~3.6B active)
in native MXFP4 (~11.3 GB). On a 16 GB box it decodes faster than a dense Qwen
9B, because only ~3.6B parameters fire per token, at o3-mini-class quality. It
carries no infill tokens, so it drives chat, edit, and agent modes but not
inline autocomplete. Sliding-window attention keeps the 128K KV near 1.7 GB,
so the full context fits GPU-only.

gpt-oss uses the harmony response format, its own sampler (temp 1.0, top-p
1.0), and no repetition penalty. Reasoning rides the harmony analysis channel,
so the flag is `--reasoning-format none` with no token budget. `-c 0` loads
the model's full 128K context:

```sh
llama-server -hf ggml-org/gpt-oss-20b-GGUF \
  -c 0 --cache-type-k q8_0 --cache-type-v q8_0 \
  -ngl auto -fa on --alias qwen-local --jinja \
  --temp 1.0 --top-p 1.0 --top-k 40 --min-p 0 \
  --presence-penalty 0.0 --repeat-penalty 1.0 \
  --reasoning-format none \
  --host 127.0.0.1 --port 8080
```

On a gpt-oss endpoint set `hackl.autocomplete.enabled` to false, or point
`hackl.autocomplete.endpoint` at a separate Qwen Coder server for completion.

Web UI: <http://127.0.0.1:8080/>.

## 3. Point Hackl at it

Hackl probes the common local ports on its own. To pin it, set the endpoint in settings:

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
