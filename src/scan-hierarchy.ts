import * as fs from 'fs';
import * as path from 'path';

const ROOT_PATH = '/Users/satchwaldman/Desktop';
const OUTPUT_PATH = path.join(__dirname, 'hierarchy-generated.json');

// Folders to completely skip (don't descend into)
const SKIP_FOLDERS = new Set([
  // Code internals
  'node_modules',
  'src',
  'dist',
  'build',
  'target',
  'vendor',
  '__pycache__',
  'venv',
  '.venv',
  'env',
  '.env',
  'out',
  'bin',
  'obj',
  'lib',
  'libs',
  '.git',
  '.svn',
  '.hg',
  
  // Build/cache
  'cache',
  '.cache',
  'tmp',
  'temp',
  'logs',
  '.logs',
  
  // IDE/editor
  '.idea',
  '.vscode',
  '.vs',
  
  // OS generated
  '.Trash',
  '.Spotlight-V100',
  '.fseventsd',
  
  // Package managers
  'bower_components',
  '.npm',
  'jspm_packages',
  
  // Other
  'coverage',
  '.nyc_output',
  '.pytest_cache',
  '.tox',
  'htmlcov',
  '__snapshots__',
]);

// Files that indicate "this is a project root, don't go deeper into code structure"
const PROJECT_MARKERS = [
  'package.json',
  'Cargo.toml',
  'setup.py',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Makefile',
  'CMakeLists.txt',
  '.xcodeproj',
  '.xcworkspace',
];

// Max depth as safety net
const MAX_DEPTH = 15;

type Hierarchy = { [key: string]: Hierarchy };

function shouldSkipFolder(name: string): boolean {
  // Skip hidden folders
  if (name.startsWith('.')) {
    return true;
  }
  
  // Skip known code/system folders
  if (SKIP_FOLDERS.has(name) || SKIP_FOLDERS.has(name.toLowerCase())) {
    return true;
  }
  
  // Skip app bundles and package files (macOS treats these as folders but they're really files)
  const bundleExtensions = [
    '.app', '.bundle', '.framework', '.plugin', '.kext',
    '.logicx', '.band', '.garageband',  // Logic/GarageBand projects
    '.fcpbundle', '.fcpproject',         // Final Cut Pro
    '.photoslibrary', '.photolibrary',   // Photos
    '.xcodeproj', '.xcworkspace',        // Xcode
    '.sparsebundle', '.dmg',             // Disk images
    '.keynote', '.pages', '.numbers',    // iWork
    '.docx', '.xlsx', '.pptx',           // Office (sometimes seen as folders)
    '.zip', '.tar', '.gz',               // Archives
  ];
  
  const lowerName = name.toLowerCase();
  for (const ext of bundleExtensions) {
    if (lowerName.endsWith(ext)) {
      return true;
    }
  }
  
  return false;
}

function isProjectRoot(folderPath: string): boolean {
  try {
    const entries = fs.readdirSync(folderPath);
    for (const marker of PROJECT_MARKERS) {
      if (entries.some(e => e === marker || e.endsWith(marker))) {
        return true;
      }
    }
  } catch {
    // Ignore permission errors
  }
  return false;
}

function scanFolder(folderPath: string, depth: number = 0): Hierarchy {
  const result: Hierarchy = {};
  
  if (depth >= MAX_DEPTH) {
    return result;
  }
  
  let entries: string[];
  try {
    entries = fs.readdirSync(folderPath);
  } catch (err) {
    // Permission denied or other error
    return result;
  }
  
  // Check if this is a project root
  const isProject = isProjectRoot(folderPath);
  
  for (const entry of entries.sort()) {
    const fullPath = path.join(folderPath, entry);
    
    // Skip if not a directory
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    
    if (!stat.isDirectory()) {
      continue;
    }
    
    // Skip certain folders
    if (shouldSkipFolder(entry)) {
      continue;
    }
    
    // If parent is a project root, we might want to limit depth
    // But for now, let's still include subfolders that aren't code-related
    // This allows things like "docs" folders inside projects
    
    // Recursively scan
    const children = scanFolder(fullPath, depth + 1);
    result[entry] = children;
  }
  
  return result;
}

function countFolders(hierarchy: Hierarchy): number {
  let count = Object.keys(hierarchy).length;
  for (const key of Object.keys(hierarchy)) {
    count += countFolders(hierarchy[key]);
  }
  return count;
}

function printHierarchy(hierarchy: Hierarchy, indent: number = 0): void {
  const indentStr = '  '.repeat(indent);
  for (const [key, value] of Object.entries(hierarchy)) {
    const childCount = countFolders(value);
    const suffix = childCount > 0 ? ` (${childCount} subfolders)` : '';
    console.log(`${indentStr}${key}${suffix}`);
    if (indent < 2) { // Only print first 3 levels to console
      printHierarchy(value, indent + 1);
    }
  }
}

console.log(`Scanning ${ROOT_PATH}...\n`);

const hierarchy = scanFolder(ROOT_PATH);
const totalFolders = countFolders(hierarchy);

console.log(`Found ${totalFolders} folders total.\n`);
console.log('Top-level structure (first 3 levels):\n');
printHierarchy(hierarchy);

// Save full hierarchy to file
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(hierarchy, null, 2));
console.log(`\nFull hierarchy saved to: ${OUTPUT_PATH}`);
