/**
 * Business errors raised by the domain and application layers. They carry a *kind*
 * (what went wrong) and a stable machine-readable *code*, never an HTTP status:
 * mapping kinds to transport-specific responses is the interface layer's job.
 */
export type ErrorKind =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'unprocessable'
  | 'unavailable';

export class DomainError extends Error {
  constructor(
    readonly kind: ErrorKind,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const validation = (code: string, message: string) =>
  new DomainError('validation', code, message);
export const unauthorized = (code = 'unauthorized', message = 'Sign in required') =>
  new DomainError('unauthorized', code, message);
export const forbidden = (code = 'forbidden', message = 'You do not have permission to do this') =>
  new DomainError('forbidden', code, message);
export const notFound = (code = 'not_found', message = 'Not found') =>
  new DomainError('not_found', code, message);
export const conflict = (code: string, message: string) =>
  new DomainError('conflict', code, message);
export const gone = (code: string, message: string) => new DomainError('gone', code, message);
export const unprocessable = (code: string, message: string) =>
  new DomainError('unprocessable', code, message);
export const unavailable = (code: string, message: string) =>
  new DomainError('unavailable', code, message);
