import { describe, expect, it } from 'vitest';
import { formatConfigContent } from './config-format';

describe('formatConfigContent', () => {
  it('formats valid YAML and keeps its comments', () => {
    expect(formatConfigContent('dns:\n enable: true # resolver\n listen: 0.0.0.0:53\n', 'yaml'))
      .toBe('dns:\n  enable: true # resolver\n  listen: 0.0.0.0:53\n');
  });

  it('formats JSON and JSONC without dropping comments', () => {
    expect(formatConfigContent('{"log":{"loglevel":"warning"}}', 'json'))
      .toBe('{\n  "log": {\n    "loglevel": "warning"\n  }\n}\n');
    expect(formatConfigContent('{"log":{/*keep*/"loglevel":"warning"}}', 'jsonc'))
      .toContain('/*keep*/');
  });

  it('rejects invalid structured content and leaves plain text unchanged', () => {
    expect(() => formatConfigContent('dns: [', 'yaml')).toThrow();
    expect(formatConfigContent('1\n  2\n', 'text')).toBe('1\n  2\n');
  });
});
