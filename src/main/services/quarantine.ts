import { runProcess } from './process-runner';
import { getLogger } from '../lib/logger';

/**
 * Strip macOS quarantine extended attribute from a path recursively.
 */
export async function stripQuarantine(targetPath: string): Promise<boolean> {
  const log = getLogger();
  log.info({ path: targetPath }, 'Stripping quarantine');

  try {
    const result = await runProcess('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', targetPath]);
    if (result.exitCode === 0) {
      log.info({ path: targetPath }, 'Quarantine stripped');
      return true;
    }
    log.warn({ path: targetPath, exitCode: result.exitCode, stderr: result.stderr }, 'xattr non-zero exit');
    return false;
  } catch (err) {
    log.error({ path: targetPath, err }, 'Failed to strip quarantine');
    return false;
  }
}
