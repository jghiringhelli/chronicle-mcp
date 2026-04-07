/**
 * Node.js implementation of the IdGenerator port using crypto.randomUUID().
 */

import crypto from 'node:crypto';
import type { IdGenerator } from '../../ports/gateways/id-generator.js';
import type { MemoryId, TriggerId, SessionId } from '../../domain/types.js';

export class NodeIdGenerator implements IdGenerator {
  /** @returns New unique memory identifier */
  memoryId(): MemoryId {
    return `mem_${crypto.randomUUID()}`;
  }

  /** @returns New unique trigger identifier */
  triggerId(): TriggerId {
    return `trig_${crypto.randomUUID()}`;
  }

  /** @returns New unique session identifier */
  sessionId(): SessionId {
    return `sess_${crypto.randomUUID()}`;
  }
}
