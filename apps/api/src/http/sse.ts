import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AiStreamEvent } from '@team-os/shared';
import { DomainError } from '../shared/domain/errors.js';

/**
 * Streams events as Server-Sent Events (`data: <json>` per event). Call it once the request
 * is authorized: errors before streaming are normal HTTP errors, errors during streaming
 * become a final `error` event. Stops the source when the client disconnects.
 */
export async function sendEventStream(
  req: FastifyRequest,
  reply: FastifyReply,
  start: (signal: AbortSignal) => Promise<AsyncIterable<AiStreamEvent>>,
) {
  const abort = new AbortController();
  const events = await start(abort.signal);

  reply.hijack();
  const res = reply.raw;
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Stops proxies such as nginx from buffering the stream.
    'x-accel-buffering': 'no',
    'x-request-id': req.id,
  });
  const send = (event: AiStreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

  try {
    for await (const event of events) {
      if (abort.signal.aborted) break;
      send(event);
    }
  } catch (err) {
    if (!abort.signal.aborted) {
      if (err instanceof DomainError) {
        send({ type: 'error', code: err.code, message: err.message });
      } else {
        req.log.error({ err }, 'AI stream failed');
        send({
          type: 'error',
          code: 'ai_failed',
          message: 'Something went wrong generating this.',
        });
      }
    }
  } finally {
    res.end();
  }
}
