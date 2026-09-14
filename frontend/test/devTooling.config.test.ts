/**
 * Dev tooling contract (spec R1, R2): the `preview_start` configurations in
 * .claude/launch.json and the Vite dev-server port. `full-stack` applies the
 * Alembic app schema (`db-migrate`) before the backend starts. A second
 * worktree takes another port through `PORT`; an unset or non-numeric value
 * falls back to 8080.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { UserConfigFnObject } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import viteConfig from '../../vite.config';

const here = dirname(fileURLToPath(import.meta.url));

interface LaunchConfiguration {
  name: string;
  runtimeExecutable?: string;
  runtimeArgs?: string[];
  port?: number;
  autoPort?: boolean;
  url?: string;
}

function readLaunchConfigurations(): LaunchConfiguration[] {
  const raw = readFileSync(resolve(here, '../../.claude/launch.json'), 'utf-8');
  return (JSON.parse(raw) as { configurations: LaunchConfiguration[] }).configurations;
}

function devServerPort(): number | undefined {
  return (viteConfig as UserConfigFnObject)({ command: 'serve', mode: 'development' }).server?.port;
}

describe('dev tooling config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('launch.json declares frontend, backend and full-stack with the agreed ports', () => {
    // toStrictEqual: an extra key (a stray `autoPort`, a `url` attach entry) fails,
    // and so does a full-stack command that skips `db-migrate` or reorders it.
    expect(readLaunchConfigurations()).toStrictEqual([
      { name: 'frontend', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: 8080 },
      { name: 'backend', runtimeExecutable: 'make', runtimeArgs: ['backend'], port: 8000 },
      {
        name: 'full-stack',
        runtimeExecutable: 'sh',
        runtimeArgs: ['-c', 'make supabase-start supabase-migrate db-migrate backend-start && npm run dev'],
        port: 8080,
        autoPort: true,
      },
    ]);
  });

  it('vite dev server honours PORT and falls back to 8080', () => {
    vi.stubEnv('PORT', '5174');
    expect(devServerPort()).toBe(5174);

    vi.stubEnv('PORT', undefined);
    expect(process.env.PORT).toBeUndefined();
    expect(devServerPort()).toBe(8080);

    vi.stubEnv('PORT', 'abc');
    expect(devServerPort()).toBe(8080);
  });
});
