import { normalizeOpenAIEndpoint } from "./openAIEndpoint";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatClientOptions {
  endpoint: string;
  model: string;
  enableThinking?: boolean;
  reasoningBudget?: number;
  // Bearer token for authenticated OpenAI-compatible endpoints (e.g. OpenRouter).
  // Omitted for keyless local servers (llama.cpp, LM Studio, Ollama).
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export interface ChatCompletion {
  content: string;
  model?: string;
  reasoning?: string;
}

export interface ChatBackend {
  complete(messages: ChatMessage[], options?: ChatCompleteOptions): Promise<ChatCompletion>;
}

export interface ChatCompleteOptions {
  onDelta?: (delta: ChatDelta) => void;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  enableThinking?: boolean;
}

export type ChatDelta =
  | { type: "answer"; text: string }
  | { type: "reasoning"; text: string };

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string;
      reasoning_content?: string;
      reasoning?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export function createOpenAICompatibleBackend(options: ChatClientOptions): ChatBackend {
  return new OpenAICompatibleBackend(options);
}

export async function sendChat(messages: ChatMessage[], options: ChatClientOptions): Promise<string> {
  const completion = await createOpenAICompatibleBackend(options).complete(messages);
  return completion.content;
}

class OpenAICompatibleBackend implements ChatBackend {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ChatClientOptions) {
    this.endpoint = normalizeOpenAIEndpoint(options.endpoint);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(messages: ChatMessage[], options: ChatCompleteOptions = {}): Promise<ChatCompletion> {
    const response = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildRequestBody(messages, Boolean(options.onDelta), options)),
      signal: options.signal,
    });

    if (!response.ok) {
      const payload = await readJson(response);
      throw new Error(payload.error?.message ?? `Chat request failed with HTTP ${response.status}`);
    }

    if (options.onDelta) {
      return readStream(response, options.onDelta);
    }

    const payload = await readJson(response);

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Chat response did not contain assistant content.");
    }
    const reasoning = payload.choices?.[0]?.message?.reasoning_content ?? payload.choices?.[0]?.message?.reasoning;
    return definedCompletion({ content, model: payload.model, reasoning });
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const apiKey = this.options.apiKey?.trim();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    return headers;
  }

  private buildRequestBody(
    messages: ChatMessage[],
    stream: boolean,
    requestOptions: ChatCompleteOptions,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
        model: this.options.model,
        messages,
        stream,
        temperature: 0.2,
    };
    if (typeof requestOptions.maxOutputTokens === "number" && Number.isFinite(requestOptions.maxOutputTokens)) {
      body.max_tokens = Math.max(1, Math.floor(requestOptions.maxOutputTokens));
    }
    const enableThinking = requestOptions.enableThinking ?? this.options.enableThinking;
    if (enableThinking === false) {
      body.chat_template_kwargs = { enable_thinking: false };
      body.enable_thinking = false;
    } else if (typeof this.options.reasoningBudget === "number" && Number.isFinite(this.options.reasoningBudget)) {
      // Cap hidden reasoning so a thinking model does not loop through the
      // whole turn in agent mode. llama.cpp honors this per request unless the
      // server was started with --reasoning-budget; -1 is unrestricted, 0 ends
      // thinking immediately.
      body.thinking_budget_tokens = this.options.reasoningBudget;
    }
    return body;
  }
}

async function readJson(response: Response): Promise<ChatCompletionResponse> {
  try {
    return await response.json() as ChatCompletionResponse;
  } catch {
    return {};
  }
}

async function readStream(response: Response, onDelta: (delta: ChatDelta) => void): Promise<ChatCompletion> {
  if (!response.body) {
    throw new Error("Chat response did not contain a stream body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const content: string[] = [];
  const reasoning: string[] = [];
  let model: string | undefined;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const parsed = consumeSseBuffer(buffer);
    buffer = parsed.rest;

    for (const event of parsed.events) {
      const chunk = parseStreamChunk(event);
      if (!chunk) {
        continue;
      }
      model = chunk.model ?? model;
      appendDelta(chunk.reasoning, reasoning, (text) => onDelta({ type: "reasoning", text }));
      appendDelta(chunk.content, content, (text) => onDelta({ type: "answer", text }));
    }

    if (done) {
      break;
    }
  }

  return definedCompletion({
    content: content.join(""),
    reasoning: reasoning.join(""),
    model,
  });
}

interface SseEvents {
  events: string[];
  rest: string;
}

interface StreamChunk {
  content?: string;
  reasoning?: string;
  model?: string;
}

function consumeSseBuffer(buffer: string): SseEvents {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const events: string[] = [];
  let cursor = 0;

  while (true) {
    const next = normalized.indexOf("\n\n", cursor);
    if (next < 0) {
      return { events, rest: normalized.slice(cursor) };
    }
    events.push(normalized.slice(cursor, next));
    cursor = next + 2;
  }
}

function parseStreamChunk(event: string): StreamChunk | undefined {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim())
    .join("\n");

  if (!data || data === "[DONE]") {
    return undefined;
  }

  const payload = JSON.parse(data) as {
    model?: string;
    choices?: Array<{
      delta?: {
        content?: string;
        reasoning_content?: string;
        reasoning?: string;
      };
    }>;
  };
  const delta = payload.choices?.[0]?.delta;
  return {
    model: payload.model,
    content: delta?.content,
    reasoning: delta?.reasoning_content ?? delta?.reasoning,
  };
}

function appendDelta(
  text: string | undefined,
  target: string[],
  emit: (text: string) => void,
): void {
  if (!text) {
    return;
  }
  target.push(text);
  emit(text);
}

function definedCompletion(completion: ChatCompletion): ChatCompletion {
  return {
    content: completion.content,
    ...(completion.model ? { model: completion.model } : {}),
    ...(completion.reasoning ? { reasoning: completion.reasoning } : {}),
  };
}
