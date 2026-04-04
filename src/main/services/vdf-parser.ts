import type { Depot } from '../../shared/types';

export interface VDFObject {
  [key: string]: string | VDFObject;
}
export type VDFValue = string | VDFObject;

type Token =
  | { type: 'string'; value: string }
  | { type: 'openBrace' }
  | { type: 'closeBrace' };

/**
 * Parse a VDF (Valve Data Format) string into a nested object.
 */
export function parseVDF(input: string): VDFObject {
  const tokens = tokenize(input);
  let pos = 0;

  function parseObject(): VDFObject {
    const obj: VDFObject = {};
    while (pos < tokens.length) {
      const token = tokens[pos];
      if (token.type === 'closeBrace') {
        pos++;
        return obj;
      }
      if (token.type !== 'string') {
        pos++;
        continue;
      }
      const key = token.value;
      pos++;
      if (pos >= tokens.length) break;

      const next = tokens[pos];
      if (next.type === 'openBrace') {
        pos++;
        obj[key] = parseObject();
      } else if (next.type === 'string') {
        obj[key] = next.value;
        pos++;
      }
    }
    return obj;
  }

  return parseObject();
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const chars = [...input];
  let i = 0;

  while (i < chars.length) {
    const ch = chars[i];

    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Line comment
    if (ch === '/' && i + 1 < chars.length && chars[i + 1] === '/') {
      while (i < chars.length && chars[i] !== '\n') i++;
      continue;
    }

    // Braces
    if (ch === '{') {
      tokens.push({ type: 'openBrace' });
      i++;
      continue;
    }
    if (ch === '}') {
      tokens.push({ type: 'closeBrace' });
      i++;
      continue;
    }

    // Quoted string
    if (ch === '"') {
      i++;
      let str = '';
      while (i < chars.length && chars[i] !== '"') {
        if (chars[i] === '\\' && i + 1 < chars.length) {
          i++;
          const esc = chars[i];
          if (esc === 'n') str += '\n';
          else if (esc === 't') str += '\t';
          else if (esc === '\\') str += '\\';
          else if (esc === '"') str += '"';
          else str += esc;
        } else {
          str += chars[i];
        }
        i++;
      }
      if (i < chars.length) i++; // skip closing quote
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Unquoted string (until whitespace or brace)
    let str = '';
    while (i < chars.length && chars[i] !== ' ' && chars[i] !== '\t' &&
           chars[i] !== '\n' && chars[i] !== '\r' && chars[i] !== '{' &&
           chars[i] !== '}' && chars[i] !== '"') {
      str += chars[i];
      i++;
    }
    if (str) {
      tokens.push({ type: 'string', value: str });
    }
  }

  return tokens;
}

/**
 * Extract depot information from parsed VDF app info.
 * Navigates the tree to find the "depots" section.
 */
export function extractDepots(vdf: VDFObject): Depot[] {
  // The depots section can be at various depths depending on steamcmd output
  let depots = findDepotsSection(vdf, 0);
  if (!depots) return [];

  const result: Depot[] = [];

  for (const [key, value] of Object.entries(depots)) {
    // Skip non-numeric keys (like "branches")
    if (!/^\d+$/.test(key)) continue;
    if (typeof value === 'string') continue;

    const depotObj = value as VDFObject;
    const name = (depotObj['name'] as string) || `Depot ${key}`;

    // OS list from config.oslist or top-level oslist
    let oslistStr = '';
    const config = depotObj['config'] as VDFObject | undefined;
    if (config && typeof config === 'object') {
      oslistStr = (config['oslist'] as string) || '';
    }
    if (!oslistStr) {
      oslistStr = (depotObj['oslist'] as string) || '';
    }
    const oslist = oslistStr
      ? oslistStr.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Max size
    const maxSizeStr = depotObj['maxsize'] as string;
    const maxSize = maxSizeStr ? parseInt(maxSizeStr, 10) : null;

    // Manifests
    const manifests: Record<string, string> = {};
    const manifestSection = depotObj['manifests'] as VDFObject | undefined;
    if (manifestSection && typeof manifestSection === 'object') {
      for (const [branch, gid] of Object.entries(manifestSection)) {
        if (typeof gid === 'string') {
          manifests[branch] = gid;
        }
      }
    }

    result.push({ id: key, name, oslist, maxSize: maxSize && !isNaN(maxSize) ? maxSize : null, manifests });
  }

  return result;
}

function findDepotsSection(obj: VDFObject, depth: number): VDFObject | null {
  if (depth > 3) return null;

  if (obj['depots'] && typeof obj['depots'] === 'object') {
    return obj['depots'] as VDFObject;
  }

  for (const value of Object.values(obj)) {
    if (typeof value === 'object') {
      const found = findDepotsSection(value as VDFObject, depth + 1);
      if (found) return found;
    }
  }

  return null;
}
