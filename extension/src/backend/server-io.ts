import { serializeJsonLine } from '../shared/jsonl';
import type { ErrorPayload, EventEnvelope, ResponseEnvelope } from '../shared/protocol';

export function writeStdout(value: EventEnvelope | ResponseEnvelope): void {
  process.stdout.write(serializeJsonLine(value));
}

export function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

export function extractRequestError(error: unknown): ErrorPayload {
  if (error instanceof Error) {
    return { code: 'BACKEND_ERROR', message: error.message };
  }
  return { code: 'BACKEND_ERROR', message: String(error) };
}

export function responseOk(id: string, result?: unknown): ResponseEnvelope {
  return { id, ok: true, result };
}

export function responseError(
  id: string,
  code: string,
  message: string,
  data?: unknown,
): ResponseEnvelope {
  return { id, ok: false, error: { code, message, data } };
}
