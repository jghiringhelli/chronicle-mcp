/**
 * Chronicle custom exception hierarchy.
 */

export class ChronicleError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ChronicleError';
  }
}

export class NotFoundError extends ChronicleError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', { resource, id });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends ChronicleError {
  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR', { field });
    this.name = 'ValidationError';
  }
}

export class StorageError extends ChronicleError {
  /**
   * @param message - What operation failed, in the caller's terms
   * @param cause - The underlying driver error
   *
   * The cause is folded into `message`, not just stashed in `context`. It used to be
   * context-only, and nothing printed it: a real cloud-sync failure surfaced to the user as
   * `Error: Team sync failed` with no indication of what went wrong — the MCP layer serialises
   * `message` and nothing else. An error that cannot say why is an error nobody can act on.
   *
   * Also chained through the native `cause` option, so a stack-walking consumer still gets the
   * original object rather than a string.
   */
  constructor(message: string, cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : cause == null ? '' : String(cause);
    super(
      detail ? `${message}: ${detail}` : message,
      'STORAGE_ERROR',
      { cause: String(cause) },
      { cause },
    );
    this.name = 'StorageError';
  }
}

export class EmbeddingError extends ChronicleError {
  constructor(message: string) {
    super(message, 'EMBEDDING_ERROR');
    this.name = 'EmbeddingError';
  }
}

export class ConfigurationError extends ChronicleError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
    this.name = 'ConfigurationError';
  }
}

export class SyncError extends ChronicleError {
  constructor(message: string, cause?: unknown) {
    super(message, 'SYNC_ERROR', { cause: String(cause) });
    this.name = 'SyncError';
  }
}
