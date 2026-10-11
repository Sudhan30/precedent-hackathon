/** Bridge eve's current runtime-context attributes to Raindrop's event lookup. */
export function linkRaindropSpan<T>(span: T): T {
  // @vercel/otel deliberately exposes exporter inputs as unknown.
  if (!span || typeof span !== 'object' || !('attributes' in span) ||
      !span.attributes || typeof span.attributes !== 'object') return span;
  const attributes: Record<string, unknown> = {...span.attributes};
  for (const key of ['eventId', 'ai.userId', 'convoId']) {
    const value = attributes['ai.settings.context.raindrop.' + key];
    if (typeof value === 'string') attributes['ai.telemetry.metadata.raindrop.' + key] = value;
  }
  // Preserve the original span and its method receivers; change only exported metadata.
  return new Proxy(span, {
    get(target, key) {
      if (key === 'attributes') return attributes;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
