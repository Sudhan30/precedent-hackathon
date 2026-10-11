import {streamText} from 'ai';
import {groq} from '@ai-sdk/groq';

// Node/tsx loads the ignored .env.local through the npm command.
const useGroq = process.argv[2] === '--groq';
const model = useGroq ? 'openai/gpt-oss-120b' : 'openai/gpt-6-astra';
const keyName = useGroq ? 'GROQ_API_KEY' : 'AI_GATEWAY_API_KEY';
const provider = useGroq ? 'Groq' : 'Gateway';
const prompt = process.argv.slice(useGroq ? 3 : 2).join(' ').trim() ||
  'Explain in two short sentences how policy enforcement before tool execution helps an enterprise AI agent.';

async function main() {
  if (!process.env[keyName]?.trim()) {
    throw new Error(`Set ${keyName} in the environment or Git-ignored .env.local before running streaming generation.`);
  }

  let failed = false;
  let receivedText = false;
  const result = streamText({
    model: useGroq ? groq(model) : model,
    prompt,
    maxOutputTokens: 2048,
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(120_000),
    // Do not log SDK errors: they may include request details or credentials.
    onError() { failed = true; },
  });

  for await (const chunk of result.textStream) {
    receivedText ||= chunk.length > 0;
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');
  if (failed || !receivedText) {
    throw new Error(`${provider} streaming failed or returned no text. Check authentication, quota and model access.`);
  }

  const usage = await result.usage;
  console.error(JSON.stringify({
    provider,
    model,
    finishReason: await result.finishReason,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  }));
}

main().catch(error => {
  // Only our fixed messages are safe to display; never dump a provider error.
  const message = error instanceof Error && (
    error.message.startsWith(`Set ${keyName}`) ||
    error.message.startsWith(`${provider} streaming failed`)
  ) ? error.message : `${provider} request failed. Check provider logs for details.`;
  console.error(message);
  process.exitCode = 1;
});
