/**
 * Unit tests for TeamService offline guards and the canCurate role policy.
 */
import { describe, it, expect, vi } from 'vitest';
import { TeamService } from '../../../src/services/team-service.js';
import { canCurate } from '../../../src/domain/entities/team.js';

vi.mock('../../../src/shared/config/index.js', () => ({
  getConfig: () => ({ userId: 'u1', teamId: 't1', railwayUrl: undefined, deviceId: 'd1', dbPath: ':memory:' }),
}));

describe('TeamService (offline / no railwayUrl)', () => {
  const svc = new TeamService();

  it('listMembers returns an empty array', async () => {
    await expect(svc.listMembers('t1')).resolves.toEqual([]);
  });

  it('getTeam returns undefined', async () => {
    await expect(svc.getTeam('t1')).resolves.toBeUndefined();
  });

  it('getMemberRole returns undefined', async () => {
    await expect(svc.getMemberRole('t1')).resolves.toBeUndefined();
  });

  it('joinTeam throws a clear configuration error', async () => {
    await expect(svc.joinTeam('t1', 'Team One')).rejects.toThrow('railwayUrl not configured');
  });

  it('assignRole throws a clear configuration error', async () => {
    await expect(svc.assignRole('t1', 'u2', 'lead')).rejects.toThrow('railwayUrl not configured');
  });

  it('mintToken throws a clear configuration error', async () => {
    await expect(svc.mintToken('t1')).rejects.toThrow('railwayUrl not configured');
  });
});

describe('canCurate', () => {
  it('permits owners and leads', () => {
    expect(canCurate('owner')).toBe(true);
    expect(canCurate('lead')).toBe(true);
  });

  it('denies plain members', () => {
    expect(canCurate('member')).toBe(false);
  });
});
