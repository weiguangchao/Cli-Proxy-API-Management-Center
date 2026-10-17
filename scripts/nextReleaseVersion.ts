// Computes the version for the rolling `latest` release. The previous release notes are the
// only state: each new main commit bumps the patch of the published version, while
// package.json owns major.minor (raising it there restarts the patch from that version).
import fs from 'node:fs';
import path from 'node:path';

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

const parseSemVer = (value: string): SemVer | null => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
};

const formatSemVer = ({ major, minor, patch }: SemVer) => `${major}.${minor}.${patch}`;

export function nextReleaseVersion(
  baseVersion: string,
  previousNotes: string,
  commitSha: string
): string {
  const base = parseSemVer(baseVersion);
  if (!base) {
    throw new Error(`package.json version must be MAJOR.MINOR.PATCH, got "${baseVersion}"`);
  }

  const previousVersion = /- Version: `([^`]+)`/.exec(previousNotes)?.[1] ?? '';
  const previous = parseSemVer(previousVersion);
  if (!previous || previous.major !== base.major || previous.minor !== base.minor) {
    return formatSemVer(base);
  }

  // A re-run for the already published commit keeps its version.
  const previousSha = /\/commit\/([0-9a-f]{7,40})\b/.exec(previousNotes)?.[1];
  if (previousSha && commitSha && previousSha === commitSha) {
    return formatSemVer(previous);
  }

  return formatSemVer({ ...base, patch: Math.max(previous.patch + 1, base.patch) });
}

if (import.meta.main) {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, '../package.json'), 'utf8'));
  console.log(
    nextReleaseVersion(
      String(pkg.version ?? ''),
      process.env.PREVIOUS_RELEASE_NOTES ?? '',
      process.env.GITHUB_SHA ?? ''
    )
  );
}
