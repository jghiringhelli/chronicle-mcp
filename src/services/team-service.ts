/**
 * TeamService - join/leave teams, list members, manage roles.
 *
 * Requires railwayUrl in config. All operations are no-ops when
 * teamId is not configured (guarded at the MCP tool layer).
 */

import { getConfig } from '../shared/config/index.js';
import type { Team, TeamMember, TeamRole } from '../domain/entities/team.js';
import { createTeam, createTeamMember } from '../domain/entities/team.js';
import { StorageError } from '../shared/exceptions/index.js';

export class TeamService {
  /**
   * Join an existing team, or create it if it does not exist.
   * Upserts both the team row and the membership row.
   *
   * @param teamId - Team slug
   * @param teamName - Display name (used only on creation)
   * @param role - Member role, defaults to 'member'
   * @returns Team and membership
   */
  async joinTeam(teamId: string, teamName: string, role: TeamRole = 'member'): Promise<{ team: Team; member: TeamMember }> {
    const config = getConfig();
    if (!config.railwayUrl) throw new StorageError('railwayUrl not configured - cannot join team');

    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 2 });
    try {
      const team = createTeam(teamId, teamName);
      const member = createTeamMember(config.userId, teamId, role);

      await sql`
        INSERT INTO teams (id, name, created_at)
        VALUES (${team.id}, ${team.name}, ${team.createdAt})
        ON CONFLICT (id) DO NOTHING
      `;
      // Never silently downgrade an existing role on re-join.
      await sql`
        INSERT INTO team_members (user_id, team_id, role, joined_at)
        VALUES (${member.userId}, ${member.teamId}, ${member.role}, ${member.joinedAt})
        ON CONFLICT (user_id, team_id) DO NOTHING
      `;
      const row = await sql<{ role: string }[]>`
        SELECT role FROM team_members WHERE user_id = ${member.userId} AND team_id = ${member.teamId}
      `;
      const effectiveRole = (row[0]?.role as TeamRole) ?? role;
      return { team, member: { ...member, role: effectiveRole } };
    } catch (err) {
      throw new StorageError('Failed to join team', err);
    } finally {
      await sql.end();
    }
  }

  /**
   * List all members of a team.
   *
   * @param teamId - Team identifier
   * @returns List of team members
   */
  async listMembers(teamId: string): Promise<TeamMember[]> {
    const config = getConfig();
    if (!config.railwayUrl) return [];

    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 1 });
    try {
      const rows = await sql<{ user_id: string; team_id: string; role: string; joined_at: string }[]>`
        SELECT user_id, team_id, role, joined_at FROM team_members WHERE team_id = ${teamId}
        ORDER BY joined_at ASC
      `;
      return rows.map(r => ({
        userId: r.user_id, teamId: r.team_id,
        role: r.role as TeamRole, joinedAt: r.joined_at,
      }));
    } catch (err) {
      throw new StorageError('Failed to list team members', err);
    } finally {
      await sql.end();
    }
  }

  /**
   * Get the current user's role within a team.
   *
   * @param teamId - Team identifier
   * @returns The caller's role, or undefined if not a member
   */
  async getMemberRole(teamId: string): Promise<TeamRole | undefined> {
    const config = getConfig();
    if (!config.railwayUrl) return undefined;

    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 1 });
    try {
      const rows = await sql<{ role: string }[]>`
        SELECT role FROM team_members WHERE user_id = ${config.userId} AND team_id = ${teamId}
      `;
      return rows[0]?.role as TeamRole | undefined;
    } catch (err) {
      throw new StorageError('Failed to get member role', err);
    } finally {
      await sql.end();
    }
  }

  /**
   * Assign a role to a team member. Curation-gated to owners/leads at the tool layer.
   * Inserts the membership if the target is not yet a member.
   *
   * @param teamId - Team identifier
   * @param targetUserId - User whose role is being set
   * @param role - New role to assign
   * @returns The updated membership
   */
  async assignRole(teamId: string, targetUserId: string, role: TeamRole): Promise<TeamMember> {
    const config = getConfig();
    if (!config.railwayUrl) throw new StorageError('railwayUrl not configured - cannot assign role');

    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 2 });
    const joinedAt = new Date().toISOString();
    try {
      await sql`
        INSERT INTO team_members (user_id, team_id, role, joined_at)
        VALUES (${targetUserId}, ${teamId}, ${role}, ${joinedAt})
        ON CONFLICT (user_id, team_id) DO UPDATE SET role = EXCLUDED.role
      `;
      return { userId: targetUserId, teamId, role, joinedAt };
    } catch (err) {
      throw new StorageError('Failed to assign role', err);
    } finally {
      await sql.end();
    }
  }

  /**
   * Get team info by ID.
   *
   * @param teamId - Team identifier
   * @returns Team or undefined if not found
   */
  async getTeam(teamId: string): Promise<Team | undefined> {
    const config = getConfig();
    if (!config.railwayUrl) return undefined;

    const { default: postgres } = await import('postgres');
    const sql = postgres(config.railwayUrl, { ssl: 'require', max: 1 });
    try {
      const rows = await sql<{ id: string; name: string; created_at: string }[]>`
        SELECT id, name, created_at FROM teams WHERE id = ${teamId}
      `;
      if (rows.length === 0) return undefined;
      return { id: rows[0]!.id, name: rows[0]!.name, createdAt: rows[0]!.created_at };
    } catch (err) {
      throw new StorageError('Failed to get team', err);
    } finally {
      await sql.end();
    }
  }
}
