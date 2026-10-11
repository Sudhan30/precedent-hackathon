import { defineAgent, defineDynamic } from "eve";
import { anthropic } from "eve/models/anthropic";
import { createGroq, groq } from "@ai-sdk/groq";

// Claude routing (when ANTHROPIC_API_KEY is set), chosen per model step:
// - social messages (the API sends an empty availableTools list): Claude Haiku 5.5, low effort
// - a task's first step: Claude Sonnet 5.5, medium effort
// - a later step in the same run means the first attempt did not finish the plan
//   (for example invalid structured output), so it escalates to Claude Opus 5.5.
type Message = { role: string; content: unknown };
const text = (message: Message | undefined) =>
  typeof message?.content === "string" ? message.content : JSON.stringify(message?.content ?? "");
const claude = defineDynamic({
  events: {
    "step.started": (_event, ctx) => {
      const messages = ctx.messages as Message[];
      const request = text([...messages].reverse().find(message => message.role === "user"));
      const social = /"availableTools"\s*:\s*\[\s*\]/.test(request);
      const retry = messages.some(message => message.role === "assistant");
      const [id, reasoning] = social ? ["claude-haiku-5-5", "low"] as const : retry ? ["claude-opus-5-5", "medium"] as const : ["claude-sonnet-5-5", "medium"] as const;
      console.info(`planner model: ${id} (${social ? "social" : retry ? "escalated after an incomplete step" : "task"})`);
      return { model: anthropic(id), reasoning, modelContextWindowTokens: 1_000_000 };
    },
  },
});

// Without an Anthropic key: Groq gpt-oss-120b, failing over to the same model on
// Fireworks when Groq's free-tier quota rejects a request (429 / 413 tokens-per-minute).
const primary = groq("openai/gpt-oss-120b");
const fireworks = process.env.FIREWORKS_API_KEY
  ? createGroq({ baseURL: "https://api.fireworks.ai/inference/v1", apiKey: process.env.FIREWORKS_API_KEY })("accounts/fireworks/models/gpt-oss-120b")
  : undefined;
const quotaError = (error: unknown) => {
  const e = error as { statusCode?: number; message?: string } | undefined;
  return e?.statusCode === 429 || e?.statusCode === 413 || /\b(429|413)\b|rate.?limit|tokens per minute|request too large/i.test(String(e?.message ?? ""));
};
const failover = <T>(call: (model: typeof primary) => PromiseLike<T>) => async (): Promise<T> => {
  try {
    return await call(primary);
  } catch (error) {
    if (!fireworks || !quotaError(error)) throw error;
    console.warn("planner model: Groq quota reached; using Fireworks for this call");
    return call(fireworks);
  }
};
const groqWithFailover = {
  specificationVersion: primary.specificationVersion,
  provider: primary.provider,
  modelId: primary.modelId,
  get supportedUrls() { return primary.supportedUrls; },
  doGenerate: (options: Parameters<typeof primary.doGenerate>[0]) => failover(model => model.doGenerate(options))(),
  doStream: (options: Parameters<typeof primary.doStream>[0]) => failover(model => model.doStream(options))(),
} as typeof primary;

export default process.env.ANTHROPIC_API_KEY
  ? defineAgent({ model: claude })
  : defineAgent({ model: process.env.GROQ_API_KEY ? groqWithFailover : "openai/gpt-6-luna-fast", reasoning: "high" });
