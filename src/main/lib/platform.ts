import os from 'node:os';

export type Architecture = 'arm64' | 'x64';

export function getArchitecture(): Architecture {
  return os.arch() as Architecture;
}

export function isAppleSilicon(): boolean {
  return getArchitecture() === 'arm64';
}
