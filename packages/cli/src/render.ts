import type { SessionEvent } from "@hackl/core";

export interface RenderOptions {
  json: boolean;
  color: boolean;
  thinking: boolean;
}

const ANSI = {
  dim: "\x1b[2m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
};

// Renders streamed Session events to the terminal (or NDJSON). Tracks whether
// the answer stream is mid-line so we can emit a clean trailing newline.
export class Renderer {
  private answerStarted = false;
  private errorReported = false;

  constructor(private readonly opts: RenderOptions) {}

  // True once a failure was shown here; the exit handler then only sets the exit
  // code, so one failure never prints twice.
  get errorShown(): boolean {
    return this.errorReported;
  }

  handle(event: SessionEvent): void {
    if (this.opts.json) {
      if (event.type === "error") {
        this.errorReported = true;
      }
      process.stdout.write(`${JSON.stringify(event)}\n`);
      return;
    }
    switch (event.type) {
      case "delta":
        if (event.channel === "answer") {
          this.answerStarted = true;
          process.stdout.write(event.text);
        } else if (this.opts.thinking) {
          process.stderr.write(this.color(ANSI.dim, event.text));
        }
        break;
      case "phase":
        process.stderr.write(`${this.color(ANSI.dim, `· ${event.text}`)}\n`);
        break;
      case "token_budget":
        // Folded into phase lines already; nothing extra in text mode.
        break;
      case "done":
        if (this.answerStarted && !event.content.endsWith("\n")) {
          process.stdout.write("\n");
        }
        if (!this.answerStarted && event.content) {
          process.stdout.write(`${event.content}\n`);
        }
        break;
      case "tool_result":
        if (!event.ok) {
          const target = event.args ? `${event.name} ${event.args}` : event.name;
          process.stderr.write(`${this.color(ANSI.red, `· ${target} failed: ${event.reason ?? "no reason given"}`)}\n`);
        }
        break;
      case "error":
        this.errorReported = true;
        process.stderr.write(`${this.color(ANSI.red, `error: ${event.message}`)}\n`);
        break;
    }
  }

  private color(code: string, text: string): string {
    return this.opts.color ? `${code}${text}${ANSI.reset}` : text;
  }
}

export function statusLine(mode: string, model: string, color: boolean): string {
  const text = `hackl (${mode} · ${model})`;
  return color ? `${ANSI.cyan}${text}${ANSI.reset}` : text;
}

// A turn failure reaches main() after the Renderer already showed it. The marker
// lets the exit handler keep the exit code without repeating the message.
export class ReportedError extends Error {
  constructor(readonly failure: unknown) {
    super(failure instanceof Error ? failure.message : String(failure));
  }
}
