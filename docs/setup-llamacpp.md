# llama.cpp setup

Hackl's default local backend is llama.cpp. It can select a model, download a
pinned and SHA-256-verified llama.cpp build, and supervise the process.

## Managed setup

In VS Code, install Hackl, leave `hackl.endpoint` empty, and open the Hackl
view. The server status item is enabled by default.

In a terminal:

```sh
hackl "explain this project"  # temporary server for this client
hackl serve --open            # explicit foreground server and browser UI
hackl models                  # recommendation and installed models
hackl models remove <model>   # reclaim managed model storage
```

The first client chooses the model and launch settings. VS Code, CLI, and
desktop clients then share that process. It exits after the last client leaves;
crashed clients expire after about ten seconds. `hackl serve` remains in the
foreground until Ctrl+C.

Hackl installs no system service, login task, or tray application. Turning off
the VS Code server status item persists the choice and releases only VS Code's
client.

## Model choice

Run `hackl models`. Hackl marks a hardware-aware recommendation and shows which
catalog models are installed. Pass an alias to `hackl serve` or choose **Hackl:
Local Server: Select Model for Next Start** in VS Code.

An explicit choice applies to the next owner.

## Files

| Item | Default location |
| --- | --- |
| Configuration overrides | `~/.config/hackl/config.json` |
| Runtime state and logs | `~/.local/state/hackl/` |
| Models | llama.cpp cache, usually `~/.cache/llama.cpp/` |
| Managed llama.cpp build | `~/.cache/hackl/llama.cpp/` |

`XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_RUNTIME_DIR`,
`LLAMACPP_CACHE_ROOT`, and `LLAMACPP_HOME` are respected.

## Use your own llama.cpp server

Install a current `llama-server` from
<https://github.com/ggml-org/llama.cpp/releases>, then start it on loopback:

```sh
llama-server \
  -hf unsloth/Qwen3.5-9B-GGUF:Q4_K_M \
  --host 127.0.0.1 \
  --port 8080 \
  -c 32768 \
  --jinja
```

Set `hackl.endpoint` to `http://127.0.0.1:8080/v1`, or leave it empty for
auto-detection.

Qwen models with fill-in-the-middle tokens can serve chat and inline
autocomplete from the same llama.cpp process. Other model families may support
chat without autocomplete.

## Network safety

Managed servers bind `127.0.0.1`. `hackl serve --allow-remote` binds llama.cpp
to `0.0.0.0`; use that only on a trusted network with suitable firewall and
authentication controls. The Hackl browser UI remains loopback-only unless its
own `--host` option is changed.

## Troubleshooting

- Run `hackl models` to confirm the model is installed.
- Check `~/.local/state/hackl/engine.log` when llama.cpp fails to start.
- If another Hackl client owns a different model, close that owner and retry.

llama.cpp server documentation:
<https://github.com/ggml-org/llama.cpp/tree/master/tools/server>
