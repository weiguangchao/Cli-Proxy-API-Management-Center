import { describe, expect, test } from 'bun:test';
import { nextReleaseVersion } from '../scripts/nextReleaseVersion';

const notes = (version: string, sha: string) =>
  [
    'Rolling build of `management.html` from `main`.',
    '',
    `- Version: \`${version}\``,
    `- Commit: https://github.com/owner/repo/commit/${sha}`,
    '- Message: feat: something',
  ].join('\n');

const PREVIOUS_SHA = 'b56662b222150241fba3ef1c6731828c8a9ff32b';
const NEXT_SHA = 'fe2963330f32a933f562282165f62ae52cf57145';

describe('rolling release version', () => {
  test('bumps the patch of the previous release for a new commit', () => {
    expect(nextReleaseVersion('0.1.0', notes('0.1.0', PREVIOUS_SHA), NEXT_SHA)).toBe('0.1.1');
    expect(nextReleaseVersion('0.1.0', notes('0.1.41', PREVIOUS_SHA), NEXT_SHA)).toBe('0.1.42');
  });

  test('keeps the published version when the same commit is released again', () => {
    expect(nextReleaseVersion('0.1.0', notes('0.1.7', PREVIOUS_SHA), PREVIOUS_SHA)).toBe('0.1.7');
  });

  test('starts from package.json without a usable previous release', () => {
    expect(nextReleaseVersion('0.1.0', '', NEXT_SHA)).toBe('0.1.0');
    expect(nextReleaseVersion('0.1.0', notes('dev', PREVIOUS_SHA), NEXT_SHA)).toBe('0.1.0');
  });

  test('lets package.json move major.minor or raise the patch floor', () => {
    expect(nextReleaseVersion('0.2.0', notes('0.1.9', PREVIOUS_SHA), NEXT_SHA)).toBe('0.2.0');
    expect(nextReleaseVersion('0.1.20', notes('0.1.9', PREVIOUS_SHA), NEXT_SHA)).toBe('0.1.20');
  });

  test('rejects a non-semver package.json version', () => {
    expect(() => nextReleaseVersion('0.1', '', NEXT_SHA)).toThrow();
  });
});
