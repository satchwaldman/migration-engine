import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const INPUT_PATH = path.join(__dirname, 'hierarchy-generated.json');
const OUTPUT_PATH = path.join(__dirname, 'hierarchy.json');

type Hierarchy = { [key: string]: Hierarchy };

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

function countDescendants(node: Hierarchy): number {
  let count = Object.keys(node).length;
  for (const key of Object.keys(node)) {
    count += countDescendants(node[key]);
  }
  return count;
}

function getDepth(node: Hierarchy): number {
  if (Object.keys(node).length === 0) return 0;
  let maxDepth = 0;
  for (const key of Object.keys(node)) {
    maxDepth = Math.max(maxDepth, getDepth(node[key]));
  }
  return maxDepth + 1;
}

function truncateChildren(node: Hierarchy): Hierarchy {
  const result: Hierarchy = {};
  for (const key of Object.keys(node)) {
    result[key] = {}; // Keep the key but remove all children
  }
  return result;
}

function printPreview(node: Hierarchy, indent: number = 0, maxLines: number = 15): string[] {
  const lines: string[] = [];
  const indentStr = '  '.repeat(indent);
  
  for (const [key, value] of Object.entries(node)) {
    if (lines.length >= maxLines) {
      lines.push(`${indentStr}... and ${Object.keys(node).length - lines.length} more`);
      break;
    }
    
    const childCount = countDescendants(value);
    const suffix = childCount > 0 ? ` (${childCount} nested)` : '';
    lines.push(`${indentStr}📁 ${key}${suffix}`);
    
    // Show first few children
    if (indent < 2 && Object.keys(value).length > 0) {
      const childLines = printPreview(value, indent + 1, 5);
      for (const line of childLines) {
        if (lines.length >= maxLines) break;
        lines.push(line);
      }
    }
  }
  
  return lines;
}

async function processNode(
  node: Hierarchy, 
  currentPath: string[],
  decisions: Map<string, 'keep' | 'prune' | 'truncate' | 'recurse'>
): Promise<Hierarchy> {
  const result: Hierarchy = {};
  const keys = Object.keys(node);
  
  if (keys.length === 0) {
    return result;
  }
  
  const pathStr = currentPath.length > 0 ? currentPath.join(' / ') : 'ROOT';
  const totalDescendants = countDescendants(node);
  const depth = getDepth(node);
  
  console.log('\n' + '='.repeat(70));
  console.log(`📍 Current location: ${pathStr}`);
  console.log(`   ${keys.length} immediate children, ${totalDescendants} total descendants, ${depth} levels deep`);
  console.log('='.repeat(70));
  
  // Show preview
  console.log('\nPreview of contents:');
  const preview = printPreview(node, 0, 20);
  for (const line of preview) {
    console.log(line);
  }
  
  console.log('\nOptions:');
  console.log('  [k]eep all    - Keep this entire subtree as-is (all descendants)');
  console.log('  [p]rune       - Remove this entire subtree');
  console.log('  [t]runcate    - Keep immediate children only (remove their descendants)');
  console.log('  [r]ecurse     - Go through each child one by one');
  console.log('  [s]elect      - Pick specific children to keep/process');
  console.log('  [q]uit        - Save progress and exit');
  
  const answer = await ask('\nChoice: ');
  
  if (answer === 'q') {
    console.log('\nSaving progress...');
    throw new Error('USER_QUIT');
  }
  
  if (answer === 'k') {
    // Keep everything as-is
    return node;
  }
  
  if (answer === 'p') {
    // Prune - return empty
    return {};
  }
  
  if (answer === 't') {
    // Truncate - keep keys but remove all children
    return truncateChildren(node);
  }
  
  if (answer === 's') {
    // Select mode - let user pick which children to process
    console.log('\nChildren:');
    const childKeys = Object.keys(node);
    for (let i = 0; i < childKeys.length; i++) {
      const key = childKeys[i];
      const childCount = countDescendants(node[key]);
      console.log(`  [${i + 1}] ${key} (${childCount} nested)`);
    }
    
    console.log('\nEnter numbers separated by commas to KEEP (e.g., "1,3,5")');
    console.log('Or enter "all" to keep all, "none" to remove all');
    console.log('Prefix with "r:" to recurse into those (e.g., "r:1,3" or "1,r:3,5")');
    
    const selection = await ask('Selection: ');
    
    if (selection === 'all') {
      return node;
    }
    
    if (selection === 'none') {
      return {};
    }
    
    // Parse selection
    const parts = selection.split(',').map(s => s.trim());
    const toKeep = new Set<number>();
    const toRecurse = new Set<number>();
    
    for (const part of parts) {
      if (part.startsWith('r:')) {
        const num = parseInt(part.slice(2));
        if (!isNaN(num) && num >= 1 && num <= childKeys.length) {
          toRecurse.add(num - 1);
          toKeep.add(num - 1);
        }
      } else {
        const num = parseInt(part);
        if (!isNaN(num) && num >= 1 && num <= childKeys.length) {
          toKeep.add(num - 1);
        }
      }
    }
    
    for (let i = 0; i < childKeys.length; i++) {
      const key = childKeys[i];
      if (toKeep.has(i)) {
        if (toRecurse.has(i)) {
          result[key] = await processNode(node[key], [...currentPath, key], decisions);
        } else {
          result[key] = node[key];
        }
      }
      // If not in toKeep, it gets pruned (not added to result)
    }
    
    return result;
  }
  
  if (answer === 'r') {
    // Recurse through each child
    for (const key of keys) {
      const childCount = countDescendants(node[key]);
      
      if (childCount === 0) {
        // Leaf node - just ask keep/prune
        const keepIt = await ask(`  Keep "${key}"? [y/n]: `);
        if (keepIt === 'y' || keepIt === 'yes') {
          result[key] = {};
        }
      } else {
        console.log(`\n--- Child: ${key} (${childCount} descendants) ---`);
        const childAnswer = await ask(`  [k]eep all / [p]rune / [t]runcate / [r]ecurse into it: `);
        
        if (childAnswer === 'k') {
          result[key] = node[key];
        } else if (childAnswer === 'p') {
          // Skip - don't add to result
        } else if (childAnswer === 't') {
          result[key] = truncateChildren(node[key]);
        } else if (childAnswer === 'r') {
          result[key] = await processNode(node[key], [...currentPath, key], decisions);
        } else {
          // Default to keep
          result[key] = node[key];
        }
      }
    }
    
    return result;
  }
  
  // Default - keep as-is
  console.log('Unknown option, keeping as-is');
  return node;
}

async function main() {
  console.log('='.repeat(70));
  console.log('HIERARCHY PRUNING TOOL');
  console.log('='.repeat(70));
  console.log(`\nLoading: ${INPUT_PATH}`);
  
  if (!fs.existsSync(INPUT_PATH)) {
    console.error('Error: hierarchy-generated.json not found. Run "npm run scan" first.');
    process.exit(1);
  }
  
  const hierarchy: Hierarchy = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf-8'));
  const totalFolders = countDescendants(hierarchy);
  
  console.log(`Loaded ${totalFolders} total folders.`);
  console.log('\nThis tool will walk you through the hierarchy and let you decide');
  console.log('what to keep, prune, or truncate at each level.\n');
  
  const decisions = new Map<string, 'keep' | 'prune' | 'truncate' | 'recurse'>();
  
  let result: Hierarchy;
  try {
    result = await processNode(hierarchy, [], decisions);
  } catch (e: any) {
    if (e.message === 'USER_QUIT') {
      console.log('Exiting without saving final result.');
      rl.close();
      process.exit(0);
    }
    throw e;
  }
  
  // Save result
  const finalCount = countDescendants(result);
  console.log('\n' + '='.repeat(70));
  console.log(`DONE! Reduced from ${totalFolders} to ${finalCount} folders.`);
  console.log(`Saving to: ${OUTPUT_PATH}`);
  
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log('Saved!');
  
  rl.close();
}

main().catch((err) => {
  console.error('Error:', err);
  rl.close();
  process.exit(1);
});
