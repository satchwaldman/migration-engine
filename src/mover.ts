import * as fs from 'fs';
import * as path from 'path';
import { addFolderToHierarchy, addNestedFoldersToHierarchy, pathExists, loadHierarchy } from './utils/hierarchy';

export interface MoveResult {
  success: boolean;
  sourcePath: string;
  destinationPath: string;
  error?: string;
}

/**
 * The base paths where your folder hierarchy exists.
 * Add more as needed (Dropbox, Google Drive mount, etc.)
 */
export const BASE_PATHS = {
  local: '/Users/satchwaldman/Desktop',
  // Add more bases here, e.g.:
  // dropbox: '/Users/satchwaldman/Dropbox',
  // googleDrive: '/Users/satchwaldman/Google Drive',
};

/**
 * Converts a hierarchy path array to a filesystem path
 * @param hierarchyPath Array like ["Free Time", "Personal Projects", "In-Progress Projects"]
 * @param basePath The root folder where the hierarchy lives
 * @returns Full filesystem path
 */
export function hierarchyPathToFilesystemPath(
  hierarchyPath: string[],
  basePath: string = BASE_PATHS.local
): string {
  return path.join(basePath, ...hierarchyPath);
}

/**
 * Checks if a destination folder exists
 */
export function destinationExists(hierarchyPath: string[], basePath: string = BASE_PATHS.local): boolean {
  const fullPath = hierarchyPathToFilesystemPath(hierarchyPath, basePath);
  return fs.existsSync(fullPath);
}

/**
 * Creates a folder if it doesn't exist
 */
export function ensureFolder(hierarchyPath: string[], basePath: string = BASE_PATHS.local): void {
  const fullPath = hierarchyPathToFilesystemPath(hierarchyPath, basePath);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
}

/**
 * Moves a file to the destination folder
 * @param sourcePath Full path to the source file
 * @param hierarchyPath Array representing the destination in the hierarchy
 * @param basePath The root folder where the hierarchy lives
 * @param createIfMissing If true, create the destination folder if it doesn't exist (and update hierarchy.json)
 * @returns MoveResult with success/failure info
 */
export function moveFile(
  sourcePath: string,
  hierarchyPath: string[],
  basePath: string = BASE_PATHS.local,
  createIfMissing: boolean = false
): MoveResult {
  const fileName = path.basename(sourcePath);
  const destinationFolder = hierarchyPathToFilesystemPath(hierarchyPath, basePath);
  const destinationPath = path.join(destinationFolder, fileName);

  // Check if source exists
  if (!fs.existsSync(sourcePath)) {
    return {
      success: false,
      sourcePath,
      destinationPath,
      error: `Source file does not exist: ${sourcePath}`,
    };
  }

  // Check/create destination folder
  if (!fs.existsSync(destinationFolder)) {
    if (createIfMissing) {
      fs.mkdirSync(destinationFolder, { recursive: true });
      
      // Also update hierarchy.json
      // Find the deepest existing path in the hierarchy, then add the rest
      const hierarchy = loadHierarchy();
      let existingDepth = 0;
      let current = hierarchy;
      
      for (let i = 0; i < hierarchyPath.length; i++) {
        if (hierarchyPath[i] in current) {
          current = current[hierarchyPath[i]];
          existingDepth = i + 1;
        } else {
          break;
        }
      }
      
      // Add the new folders to hierarchy.json
      if (existingDepth < hierarchyPath.length) {
        const basePath = hierarchyPath.slice(0, existingDepth);
        const newParts = hierarchyPath.slice(existingDepth);
        addNestedFoldersToHierarchy(basePath, newParts);
      }
    } else {
      return {
        success: false,
        sourcePath,
        destinationPath,
        error: `Destination folder does not exist: ${destinationFolder}`,
      };
    }
  }

  // Check if file already exists at destination
  if (fs.existsSync(destinationPath)) {
    return {
      success: false,
      sourcePath,
      destinationPath,
      error: `File already exists at destination: ${destinationPath}`,
    };
  }

  // Move the file
  try {
    fs.renameSync(sourcePath, destinationPath);
    return {
      success: true,
      sourcePath,
      destinationPath,
    };
  } catch (err) {
    // If rename fails (cross-device), try copy + delete
    try {
      fs.copyFileSync(sourcePath, destinationPath);
      fs.unlinkSync(sourcePath);
      return {
        success: true,
        sourcePath,
        destinationPath,
      };
    } catch (copyErr) {
      return {
        success: false,
        sourcePath,
        destinationPath,
        error: `Failed to move file: ${copyErr}`,
      };
    }
  }
}

/**
 * Dry run - shows where a file would be moved without actually moving it
 */
export function dryRunMove(
  sourcePath: string,
  hierarchyPath: string[],
  basePath: string = BASE_PATHS.local
): { sourcePath: string; destinationPath: string; wouldSucceed: boolean; issue?: string } {
  const fileName = path.basename(sourcePath);
  const destinationFolder = hierarchyPathToFilesystemPath(hierarchyPath, basePath);
  const destinationPath = path.join(destinationFolder, fileName);

  if (!fs.existsSync(sourcePath)) {
    return { sourcePath, destinationPath, wouldSucceed: false, issue: 'Source does not exist' };
  }

  if (!fs.existsSync(destinationFolder)) {
    return { sourcePath, destinationPath, wouldSucceed: false, issue: 'Destination folder does not exist' };
  }

  if (fs.existsSync(destinationPath)) {
    return { sourcePath, destinationPath, wouldSucceed: false, issue: 'File already exists at destination' };
  }

  return { sourcePath, destinationPath, wouldSucceed: true };
}
