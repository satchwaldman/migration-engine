import * as fs from 'fs';
import * as path from 'path';

export type Hierarchy = { [key: string]: Hierarchy };

/**
 * Loads the hierarchy from hierarchy.json
 */
export function loadHierarchy(): Hierarchy {
  const hierarchyPath = path.join(__dirname, '..', 'hierarchy.json');
  const content = fs.readFileSync(hierarchyPath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Converts hierarchy JSON to indented text format for LLM prompts
 */
export function hierarchyToString(hierarchy: Hierarchy, indent: number = 0): string {
  const indentStr = '  '.repeat(indent);
  let result = '';
  
  for (const [key, value] of Object.entries(hierarchy)) {
    result += `${indentStr}${key}\n`;
    if (Object.keys(value).length > 0) {
      result += hierarchyToString(value, indent + 1);
    }
  }
  
  return result;
}

/**
 * Checks if a path exists in the hierarchy
 * @param hierarchy The hierarchy object
 * @param path Array of folder names representing the path
 * @returns true if the path exists, false otherwise
 */
export function pathExists(hierarchy: Hierarchy, path: string[]): boolean {
  if (path.length === 0) {
    return true; // Root always exists
  }
  
  let current = hierarchy;
  for (const folder of path) {
    if (!(folder in current)) {
      return false;
    }
    current = current[folder];
  }
  
  return true;
}

