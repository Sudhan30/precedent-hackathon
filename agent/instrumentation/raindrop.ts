import {disableInstrumentation} from "eve/instrumentation";
import { OTLPHttpProtoTraceExporter } from "@vercel/otel";
import { otelIntegration } from "eve/instrumentation/otel";
import {linkRaindropSpan} from '../../packages/observability/raindrop-span.js';

const runIdPattern = /\\?"runId\\?"\s*:\s*\\?"([0-9a-f-]{36})/;
function precedentRunId(messages: readonly {role: string; content: unknown}[]) {
  const request = messages.find(message => message.role === 'user');
  const text = typeof request?.content === 'string' ? request.content : JSON.stringify(request?.content ?? '');
  return runIdPattern.exec(text)?.[1];
}

function raindrop(key: string) {
const exporter = new OTLPHttpProtoTraceExporter({
  url: "https://api.raindrop.ai/v1/traces",
  headers: {Authorization: `Bearer ${key}`},
});

return otelIntegration({
  // The planner request carries Precedent's runId, so the model spans join the API's
  // governance trace under one Raindrop event (worker session id as a fallback).
  runtimeContext: input => ({
    'raindrop.eventId': precedentRunId(input.modelInput.messages) ?? 'precedent-worker:' + input.session.id,
    'raindrop.ai.userId': 'precedent-agent',
    'raindrop.convoId': input.session.id,
  }),
  exportPolicy: {
    span: () => ({ redact: true, inputs: true, outputs: true }),
  },
  traceExporter: {
    // eve's declaration erases the SDK span type at this exporter boundary.
    export: (spans, callback) => exporter.export(
      (spans as Parameters<typeof exporter.export>[0]).map(linkRaindropSpan), callback),
    shutdown: () => exporter.shutdown(),
    forceFlush: () => exporter.forceFlush(),
  },
});
}

export default process.env.RAINDROP_WRITE_KEY ? raindrop(process.env.RAINDROP_WRITE_KEY) : disableInstrumentation();
