/**
 * Unit tests for TeamService.
 */
import { describe, it, expect, vi } from 'vitest';
import { TeamService } from '../../../src/services/team-service.js';

vi.mock('../../../src/shared/config/index.js', () => ({
  getConfig: () => ({ userId: 'user-1', railwayUrl: undefined }),
}));

describe('TeamService', () => {
  it('listMembers returns empty array when railwayUrl is not configured', async () => {
    const svc = new TeamService();
    const members = await svc.listMembers('team-a');
    expect(members).toEqual([]);
  });

  it('getTeam returns undefined when railwayUrl is not configured', async () => {
    const svc = new TeamService();
    const team = await svc.getTeam('team-a');
    expect(team).toBeUndefined();
  });

  it('joinTeam throws when railwayUrl is not configured', async () => {
    const svc = new TeamService();
    await expect(svc.joinTeam('team-a', 'Team A')).rejects.toThrow('railwayUrl not configured');
  });
});
