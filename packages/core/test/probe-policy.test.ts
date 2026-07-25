import { describe, it, expect } from 'vitest';
import { classifyProbe } from '../src/probe/probe-policy.js';

describe('probe policy (ADR-002)', () => {
  it('classifies dead when both http and https fail', () => {
    const r = classifyProbe(false, false, null, 100);
    expect(r.health).toBe('dead');
    expect(r.openUrl).toBeNull();
  });

  it('classifies alive on http response under slow threshold', () => {
    const r = classifyProbe(true, false, 'http://127.0.0.1:5173/', 200);
    expect(r.health).toBe('alive');
    expect(r.openUrl).toBe('http://127.0.0.1:5173/');
  });

  it('classifies slow when elapsed >= 1500ms', () => {
    const r = classifyProbe(true, false, 'http://127.0.0.1:3000/', 1600);
    expect(r.health).toBe('slow');
  });

  it('falls back to https when http fails', () => {
    const r = classifyProbe(false, true, 'https://127.0.0.1:5173/', 300);
    expect(r.health).toBe('alive');
    expect(r.openUrl).toBe('https://127.0.0.1:5173/');
  });

  it('any http response including errors counts as alive', () => {
    const r = classifyProbe(true, false, 'http://127.0.0.1:8080/', 50);
    expect(r.health).toBe('alive');
  });
});
