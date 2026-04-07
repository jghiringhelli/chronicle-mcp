/**
 * Node.js implementation of the Clock port using the system clock.
 */

import type { Clock } from '../../ports/gateways/clock.js';
import type { Timestamp } from '../../domain/types.js';

export class NodeClock implements Clock {
  /** @returns Current ISO 8601 timestamp */
  now(): Timestamp {
    return new Date().toISOString();
  }

  /** @returns Current Date object */
  nowDate(): Date {
    return new Date();
  }

  /**
   * Calculate days between two timestamps.
   *
   * @param from - Start timestamp
   * @param to - End timestamp
   * @returns Number of days (can be fractional)
   */
  daysBetween(from: Timestamp, to: Timestamp): number {
    return (new Date(to).getTime() - new Date(from).getTime()) / (1000 * 60 * 60 * 24);
  }
}
