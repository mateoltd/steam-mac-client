import type { Depot } from '../../shared/types';
import { runProcess } from './process-runner';
import { parseVDF, extractDepots } from './vdf-parser';
import { getLogger } from '../lib/logger';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/**
 * Get depot information for a Steam app using steamcmd.
 * Runs `steamcmd +login anonymous +app_info_request <appId> +app_info_print <appId> +logoff +quit`
 * and parses the VDF output.
 */
export async function getDepots(appId: number, steamcmdPath: string | null): Promise<Depot[]> {
  const log = getLogger();

  if (!steamcmdPath) {
    throw new Error('steamcmd not found. Install it from Settings.');
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log.info({ appId, attempt }, 'Running steamcmd for depot info');

    const result = await runProcess(steamcmdPath, [
      '+login', 'anonymous',
      '+app_info_request', String(appId),
      '+app_info_print', String(appId),
      '+logoff',
      '+quit',
    ]);

    const vdfBlock = extractVDFBlock(result.stdout, String(appId));
    if (!vdfBlock) {
      log.warn({ appId, attempt }, 'No VDF block found in steamcmd output');
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw new Error('steamcmd did not return depot info after multiple attempts.');
    }

    try {
      const parsed = parseVDF(vdfBlock);
      const depots = extractDepots(parsed);
      log.info({ appId, depotCount: depots.length }, 'Depots parsed successfully');
      return depots;
    } catch (err) {
      log.error({ appId, attempt, err }, 'Failed to parse VDF');
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw new Error(`Failed to parse depot info: ${err}`);
    }
  }

  return [];
}

/**
 * Extract the VDF block for a given app ID from steamcmd's verbose output.
 * The block starts with a line containing the quoted app ID and ends when braces balance.
 */
function extractVDFBlock(output: string, appId: string): string | null {
  const lines = output.split('\n');
  let capturing = false;
  let braceDepth = 0;
  let block = '';

  for (const line of lines) {
    if (!capturing) {
      // Look for the start: a line with the quoted app ID followed by an opening brace
      if (line.includes(`"${appId}"`)) {
        capturing = true;
        block = line + '\n';
        braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
        continue;
      }
    }

    if (capturing) {
      block += line + '\n';
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      if (braceDepth <= 0) {
        return block;
      }
    }
  }

  return capturing ? block : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
