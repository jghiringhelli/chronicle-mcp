/**
 * Clock Port
 *
 * Interface for time operations.
 * Enables testability by abstracting system clock.
 */

import type { Timestamp } from '../../domain/types.js';

/**
 * Clock Interface
 *
 * Abstracts time operations for testability.
 * Tests can inject a fixed-time clock; production uses system clock.
 */
export interface Clock {
  /**
   * Get current timestamp as ISO 8601 string.
   *
   * @returns Current timestamp
   */
  now(): Timestamp;

  /**
   * Get current time as Date object.
   *
   * @returns Current date
   */
  nowDate(): Date;

  /**
   * Calculate days between two timestamps.
   *
   * @param from - Start timestamp
   * @param to - End timestamp
   * @returns Number of days (can be fractional)
   */
  daysBetween(from: Timestamp, to: Timestamp): number;
}
