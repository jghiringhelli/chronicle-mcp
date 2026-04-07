/**
 * Chronicle custom exception hierarchy.
 */

export class ChronicleError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
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
  constructor(message: string, cause?: unknown) {
    super(message, 'STORAGE_ERROR', { cause: String(cause) });
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
