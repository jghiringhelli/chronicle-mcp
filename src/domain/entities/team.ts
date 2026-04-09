/**
 * Team and TeamMember entities.
 *
 * Teams are identified by a slug (e.g. "pragmaworks").
 * Membership binds a userId to a teamId with a role.
 */

/** Unique identifier for a team (slug) */
export type TeamId = string;

/** Team roles */
export type TeamRole = 'member' | 'lead';

/** A Chronicle team */
export interface Team {
  readonly id: TeamId;
  readonly name: string;
  readonly createdAt: string;
}

/** A team membership record */
export interface TeamMember {
  readonly userId: string;
  readonly teamId: TeamId;
  readonly role: TeamRole;
  readonly joinedAt: string;
}

/**
 * Create a new Team entity.
 *
 * @param id - Team slug
 * @param name - Display name
 * @returns Team entity
 */
export function createTeam(id: TeamId, name: string): Team {
  return { id, name, createdAt: new Date().toISOString() };
}

/**
 * Create a new TeamMember entity.
 *
 * @param userId - User identifier
 * @param teamId - Team identifier
 * @param role - Member role, defaults to 'member'
 * @returns TeamMember entity
 */
export function createTeamMember(userId: string, teamId: TeamId, role: TeamRole = 'member'): TeamMember {
  return { userId, teamId, role, joinedAt: new Date().toISOString() };
}
