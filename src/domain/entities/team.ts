/**
 * Team and TeamMember entities.
 *
 * Teams are identified by a slug (e.g. "pragmaworks").
 * Membership binds a userId to a teamId with a role. The role governs
 * curation rights: owner and lead may curate team insights and manage
 * members; member may share, recall, and log.
 */

/** Unique identifier for a team (slug) */
export type TeamId = string;

/** Team roles, ordered by privilege: owner > lead > member */
export type TeamRole = 'owner' | 'lead' | 'member';

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

/** Roles permitted to curate team insights and manage membership. */
export const CURATOR_ROLES: readonly TeamRole[] = ['owner', 'lead'];

/**
 * Whether a role may curate team knowledge (merge/edit insights, manage members).
 *
 * @param role - The member's role
 * @returns True if the role is owner or lead
 */
export function canCurate(role: TeamRole): boolean {
  return CURATOR_ROLES.includes(role);
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
