import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('release version metadata', () => {
  it('keeps the backend-reported version aligned with the frontend release version', () => {
    const frontend = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const backend = readFileSync(new URL('../backend/Cargo.toml', import.meta.url), 'utf8')
      .match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    expect(backend).toBe(frontend.version);
  });
});
