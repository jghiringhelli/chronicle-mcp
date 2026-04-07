import { describe, it, expect } from 'vitest';
import { startSession, endSession, markSessionCrashed, updateSessionContext } from '../../../src/domain/entities/session.js';

describe('startSession', () => {
  it('creates active session with correct defaults', () => {
    const s = startSession('sess_1', { project: 'chronicle' });
    expect(s.id).toBe('sess_1');
    expect(s.project).toBe('chronicle');
    expect(s.status).toBe('active');
    expect(s.activeTasks).toEqual([]);
    expect(s.pendingDecisions).toEqual([]);
    expect(s.touchedFiles).toEqual([]);
    expect(s.endedAt).toBeUndefined();
    expect(s.summary).toBeUndefined();
  });

  it('stores device when provided', () => {
    const s = startSession('sess_2', { project: 'x', device: 'work-pc' });
    expect(s.device).toBe('work-pc');
  });
});

describe('endSession', () => {
  it('transitions status to ended and records timestamp', () => {
    const s = startSession('sess_3', { project: 'x' });
    const ended = endSession(s, 'Finished auth module');
    expect(ended.status).toBe('ended');
    expect(ended.endedAt).toBeDefined();
    expect(ended.summary).toBe('Finished auth module');
    expect(ended).not.toBe(s);
  });

  it('works without summary', () => {
    const s = startSession('sess_4', { project: 'x' });
    const ended = endSession(s);
    expect(ended.status).toBe('ended');
    expect(ended.summary).toBeUndefined();
  });
});

describe('markSessionCrashed', () => {
  it('transitions status to crashed', () => {
    const s = startSession('sess_5', { project: 'x' });
    const crashed = markSessionCrashed(s);
    expect(crashed.status).toBe('crashed');
    expect(crashed.endedAt).toBeDefined();
  });
});

describe('updateSessionContext', () => {
  it('updates active tasks', () => {
    const s = startSession('sess_6', { project: 'x' });
    const updated = updateSessionContext(s, { activeTasks: ['task-1', 'task-2'] });
    expect(updated.activeTasks).toEqual(['task-1', 'task-2']);
    expect(updated.pendingDecisions).toEqual([]);
  });

  it('preserves unchanged fields', () => {
    const s = startSession('sess_7', { project: 'x' });
    const withTasks = updateSessionContext(s, { activeTasks: ['t1'] });
    const withFiles = updateSessionContext(withTasks, { touchedFiles: ['src/a.ts'] });
    expect(withFiles.activeTasks).toEqual(['t1']);
    expect(withFiles.touchedFiles).toEqual(['src/a.ts']);
  });
});
