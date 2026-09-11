/**
 * Team license gate — shared by the `axon` and `team` tools.
 *
 * A single Chronicle Team token authorises both coordination (axon) and
 * knowledge (team) features. Validation result is cached for the process
 * lifetime (one Railway round-trip max) and fails open when Railway is
 * unreachable, so offline work is never blocked.
 */

import { TEAM_SCHEMA_SQL } from '../infrastructure/db/team-schema.js';

let _tokenValid: boolean | null = null;

/**
 * Validate a team license token against Railway.
 *
 * @param token - The configured teamToken
 * @param railwayUrl - Railway connection string, or undefined for local-only mode
 * @param teamId - The configured team slug
 * @returns True if the token is valid (or cannot be checked); false if explicitly revoked/unknown
 */
export async function validateTeamToken(
  token: string,
  railwayUrl: string | undefined,
  teamId: string,
): Promise<boolean> {
  if (_tokenValid !== null) return _tokenValid;
  if (!railwayUrl) { _tokenValid = true; return true; } // local-only mode — trust presence
  try {
    const { default: postgres } = await import('postgres');
    const sql = postgres(railwayUrl, { ssl: 'require', max: 1 });
    await sql.unsafe(TEAM_SCHEMA_SQL);
    const rows = await sql<{ token: string }[]>`
      SELECT token FROM team_licenses
      WHERE token = ${token} AND team_id = ${teamId}
        AND revoked = FALSE
        AND (expires_at IS NULL OR expires_at > NOW())
    `;
    await sql.end();
    _tokenValid = rows.length > 0;
  } catch {
    _tokenValid = true; // Railway down — fail open so offline work is not blocked
  }
  return _tokenValid;
}

/** Reset the cached validation result. Test-only seam. */
export function _resetTokenCache(): void {
  _tokenValid = null;
}
