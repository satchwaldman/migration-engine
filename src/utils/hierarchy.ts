import * as fs from 'fs';
import * as path from 'path';

export type Hierarchy = { [key: string]: Hierarchy };

const HIERARCHY_PATH = path.join(__dirname, '..', 'hierarchy.json');

/**
 * Loads the hierarchy from hierarchy.json
 */
export function loadHierarchy(): Hierarchy {
  const content = fs.readFileSync(HIERARCHY_PATH, 'utf-8');
  return JSON.parse(content);
}

/**
 * Saves the hierarchy to hierarchy.json
 */
export function saveHierarchy(hierarchy: Hierarchy): void {
  fs.writeFileSync(HIERARCHY_PATH, JSON.stringify(hierarchy, null, 2));
}

/**
 * Adds a new folder to the hierarchy and saves it
 * @param parentPath Array of folder names representing the parent path
 * @param newFolderName Name of the new folder to create
 * @returns true if added successfully, false if parent doesn't exist
 */
export function addFolderToHierarchy(parentPath: string[], newFolderName: string): boolean {
  const hierarchy = loadHierarchy();
  
  // Navigate to parent
  let current = hierarchy;
  for (const folder of parentPath) {
    if (!(folder in current)) {
      return false; // Parent path doesn't exist
    }
    current = current[folder];
  }
  
  // Add new folder if it doesn't already exist
  if (!(newFolderName in current)) {
    current[newFolderName] = {};
    saveHierarchy(hierarchy);
  }
  
  return true;
}

/**
 * Adds multiple nested folders to the hierarchy and saves it
 * Creates any missing intermediate folders along the way
 * @param basePath Array of folder names representing the existing base path
 * @param newFolderPath Array of new folder names to create (can be multiple levels)
 * @returns true if added successfully
 */
export function addNestedFoldersToHierarchy(basePath: string[], newFolderPath: string[]): boolean {
  const hierarchy = loadHierarchy();
  
  // Navigate to base path
  let current = hierarchy;
  for (const folder of basePath) {
    if (!(folder in current)) {
      return false; // Base path doesn't exist
    }
    current = current[folder];
  }
  
  // Add each level of the new folder path
  for (const folderName of newFolderPath) {
    if (!(folderName in current)) {
      current[folderName] = {};
    }
    current = current[folderName];
  }
  
  saveHierarchy(hierarchy);
  return true;
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

