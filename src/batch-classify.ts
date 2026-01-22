import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { exec } from 'child_process';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { loadHierarchy, hierarchyToString } from './utils/hierarchy';
import { classifyFile, ClassificationResult } from './classifier';
import { moveFile, dryRunMove, BASE_PATHS } from './mover';
import { trackUsage, resetSessionStats, printSessionSummary, formatCost, getSessionStats } from './usage-tracker';
import { extractText } from './text-extractor';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function classifyAndPrompt(
  absolutePath: string,
  hierarchy: any,
  dryRun: boolean,
  autoMode: boolean
): Promise<{ action: 'moved' | 'skipped' | 'error' | 'quit'; destination?: string }> {
  const filename = path.basename(absolutePath);
  const stats = fs.statSync(absolutePath);
  
  // Track current path (may change if renamed)
  let currentFilePath = absolutePath;

  // Extract text content from the file (handles PDFs, DOCX, text files, etc.)
  let fileContent = '';
  try {
    fileContent = await extractText(absolutePath);
  } catch (err) {
    fileContent = `[File: ${filename}, size: ${(stats.size / 1024).toFixed(1)} KB, extraction failed]`;
  }

  // Classify
  let result: ClassificationResult;
  try {
    result = await classifyFile(fileContent, filename, hierarchy);
  } catch (err) {
    console.log(`  ✗ Classification error: ${err}`);
    return { action: 'error' };
  }

  const targetPath = result.topChoice.isNewFolder && result.topChoice.newFolderName
    ? [...result.topChoice.path, result.topChoice.newFolderName]
    : result.topChoice.path;

  const confidence = result.topChoice.normalizedConfidence.toFixed(1);
  const pathString = targetPath.join(' / ');

  // Dry run
  if (dryRun) {
    const dryResult = dryRunMove(absolutePath, targetPath);
    console.log(`  → ${pathString} (${confidence}%)`);
    if (!dryResult.wouldSucceed) {
      console.log(`    ⚠️  ${dryResult.issue}`);
    }
    return { action: 'skipped', destination: pathString };
  }

  // Auto mode
  if (autoMode && !result.needsReview) {
    const moveResult = moveFile(absolutePath, targetPath, BASE_PATHS.local, result.topChoice.isNewFolder);
    if (moveResult.success) {
      console.log(`  ✓ → ${pathString}`);
      return { action: 'moved', destination: pathString };
    } else {
      console.log(`  ✗ Failed: ${moveResult.error}`);
      return { action: 'error' };
    }
  }

  // Interactive mode
  console.log(`  → ${pathString} (${confidence}%)${result.needsReview ? ' ⚠️' : ''}`);
  
  if (result.alternatives.length > 0) {
    console.log(`    Alt: ${result.alternatives[0].path.join(' / ')} (${result.alternatives[0].normalizedConfidence.toFixed(1)}%)`);
  }

  let answer = '';
  let currentTargetPath = targetPath;
  let currentIsNewFolder = result.topChoice.isNewFolder;
  let currentAlternatives = result.alternatives;
  
  while (true) {
    // Build dynamic prompt based on available alternatives
    const altCount = currentAlternatives.length;
    const altOption = altCount > 0 ? ` / [1${altCount > 1 ? `-${Math.min(altCount, 3)}` : ''}] alt` : '';
    answer = await ask(`    [y]es / [n]o${altOption} / [o]pen / [p]eek / [r]ename / [s]ummarize / [t]ype / [q]uit: `);
    
    if (answer.toLowerCase() === 'o') {
      // Open file in default app
      exec(`open "${currentFilePath}"`, (err) => {
        if (err) {
          console.log(`    (Could not open file: ${err.message})`);
        }
      });
      console.log('    (Opening file...)');
      continue;
    }
    
    if (answer.toLowerCase() === 'r') {
      // Rename file
      const renameChoice = await ask('    [d]escribe it yourself or [a]uto from content? ');
      
      let description = '';
      if (renameChoice.toLowerCase() === 'd') {
        description = await ask('    Describe what this file is: ');
        if (!description.trim()) {
          continue;
        }
      } else if (renameChoice.toLowerCase() === 'a') {
        description = `Based on this file content, generate a descriptive filename:\n\n${fileContent.substring(0, 3000)}`;
      } else {
        continue;
      }
      
      console.log('    Generating name...');
      try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const renameResult = await model.generateContent(
          `Generate a short, descriptive filename for this file. Use snake_case format (lowercase words separated by underscores). Keep it concise (2-5 words). Do not include the file extension.\n\n${description}\n\nRespond with ONLY the filename, nothing else.`
        );
        const usage = trackUsage(renameResult.response.usageMetadata);
        
        let suggestedName = renameResult.response.text().trim();
        // Clean up the name
        suggestedName = suggestedName
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
        
        const ext = path.extname(currentFilePath);
        const newFilename = suggestedName + ext;
        const newPath = path.join(path.dirname(currentFilePath), newFilename);
        
        console.log(`    Suggested: ${newFilename}`);
        console.log(`    (Cost: ${formatCost(usage.estimatedCost)}, Session: ${formatCost(getSessionStats().totalEstimatedCost)})`);
        
        const confirmRename = await ask('    Rename? [y]es / [n]o / [e]dit: ');
        
        if (confirmRename.toLowerCase() === 'y') {
          if (fs.existsSync(newPath)) {
            console.log('    ✗ File with that name already exists');
          } else {
            fs.renameSync(currentFilePath, newPath);
            currentFilePath = newPath; // Update for subsequent operations
            console.log(`    ✓ Renamed to ${newFilename}`);
          }
        } else if (confirmRename.toLowerCase() === 'e') {
          const editedName = await ask(`    Edit name (without extension): `);
          if (editedName.trim()) {
            const editedFilename = editedName.trim() + ext;
            const editedPath = path.join(path.dirname(currentFilePath), editedFilename);
            if (fs.existsSync(editedPath)) {
              console.log('    ✗ File with that name already exists');
            } else {
              fs.renameSync(currentFilePath, editedPath);
              currentFilePath = editedPath;
              console.log(`    ✓ Renamed to ${editedFilename}`);
            }
          }
        }
      } catch (err) {
        console.log(`    (Could not generate name: ${err})`);
      }
      continue;
    }
    
    if (answer.toLowerCase() === 'p') {
      // Peek at file contents
      const peekExt = path.extname(currentFilePath).toLowerCase();
      const textExtensionsForPeek = ['.txt', '.md', '.json', '.js', '.ts', '.py', '.html', '.css', '.csv', '.xml', '.yaml', '.yml'];
      
      if (!textExtensionsForPeek.includes(peekExt)) {
        console.log(`    (Cannot preview ${peekExt} files - use [s]ummarize for AI-powered summary)`);
        continue;
      }
      
      console.log('    --- File Preview ---');
      try {
        const content = fs.readFileSync(currentFilePath, 'utf-8');
        const lines = content.split('\n').slice(0, 10);
        const words = content.split(/\s+/).slice(0, 100).join(' ');
        // Use whichever is smaller
        const linePreview = lines.join('\n');
        const preview = linePreview.length < words.length ? linePreview : words;
        console.log(preview.substring(0, 500) + (preview.length > 500 ? '...' : ''));
      } catch {
        console.log('    (Could not read file)');
      }
      console.log('    --- End Preview ---');
      continue;
    }
    
    if (answer.toLowerCase() === 's') {
      // Get AI summary
      console.log('    Generating summary...');
      try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        
        const fileExt = path.extname(currentFilePath).toLowerCase();
        let summaryResult;
        
        if (fileExt === '.pdf') {
          // Send PDF as base64 for Gemini to read
          const fileBuffer = fs.readFileSync(currentFilePath);
          const base64Data = fileBuffer.toString('base64');
          summaryResult = await model.generateContent([
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64Data,
              },
            },
            { text: 'Summarize this document in 50 words or less. Be direct and concise.' },
          ]);
        } else {
          // Text-based files
          const content = fs.readFileSync(currentFilePath, 'utf-8').substring(0, 5000);
          summaryResult = await model.generateContent(
            `Summarize this document in 50 words or less. Be direct and concise:\n\n${content}`
          );
        }
        
        const usage = trackUsage(summaryResult.response.usageMetadata);
        console.log(`    Summary: ${summaryResult.response.text()}`);
        console.log(`    (Cost: ${formatCost(usage.estimatedCost)}, Session: ${formatCost(getSessionStats().totalEstimatedCost)})`);
      } catch (err) {
        console.log(`    (Could not summarize: ${err})`);
      }
      continue;
    }
    
    if (answer.toLowerCase() === 't') {
      // Type custom destination
      const customDest = await ask('    Where should this go? (describe in plain text, or "new: folder name" to create): ');
      if (!customDest.trim()) {
        continue;
      }
      
      console.log('    Interpreting...');
      try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        const interpretResult = await model.generateContent(
          `You are a file organization assistant. Given a user's plain text description of where they want a file to go, find the best matching folder(s) in the hierarchy below.

If the user wants to create NEW folders (they might say "new", "create", "make a folder for", or specify a path that doesn't exist), you can create MULTIPLE levels of new folders at once. Set isNewFolder to true and provide:
- "path": the deepest EXISTING parent folder in the hierarchy
- "newFolderPath": an array of NEW folder names to create (can be multiple levels deep)

For example, if the user says "Free Time / Tutoring / John / Grade 10 / Math" and only "Free Time / Tutoring" exists, return:
- "path": ["Free Time", "Tutoring"]
- "newFolderPath": ["John", "Grade 10", "Math"]
- "isNewFolder": true

Folder Hierarchy:
${hierarchyToString(hierarchy)}

User said: "${customDest}"

Return a JSON array of 1-3 folder suggestions, ordered by how well they match what the user described. Each suggestion should have:
- "path": array of folder names from root to target (existing folders only)
- "confidence": 0-100 how confident you are this is what they meant
- "isNewFolder": boolean, true if creating new folder(s)
- "newFolderPath": array of new folder names to create (only if isNewFolder is true, can be multiple levels)

Return ONLY the JSON array, no other text.`
        );
        const usage = trackUsage(interpretResult.response.usageMetadata);
        
        let jsonText = interpretResult.response.text().trim();
        if (jsonText.startsWith('\`\`\`json')) {
          jsonText = jsonText.replace(/^\`\`\`json\s*/, '').replace(/\s*\`\`\`$/, '');
        } else if (jsonText.startsWith('\`\`\`')) {
          jsonText = jsonText.replace(/^\`\`\`\s*/, '').replace(/\s*\`\`\`$/, '');
        }
        
        const interpretedSuggestions = JSON.parse(jsonText) as Array<{
          path: string[], 
          confidence: number,
          isNewFolder?: boolean,
          newFolderPath?: string[],
          newFolderName?: string  // legacy support
        }>;
        
        if (interpretedSuggestions.length > 0) {
          const top = interpretedSuggestions[0];
          
          // Update the current target and alternatives
          if (top.isNewFolder && (top.newFolderPath || top.newFolderName)) {
            // Support both newFolderPath (array) and legacy newFolderName (string)
            const newParts = top.newFolderPath || (top.newFolderName ? [top.newFolderName] : []);
            currentTargetPath = [...top.path, ...newParts];
            currentIsNewFolder = true;
          } else {
            currentTargetPath = top.path;
            currentIsNewFolder = false;
          }
          
          currentAlternatives = interpretedSuggestions.slice(1).map(s => {
            const newParts = s.newFolderPath || (s.newFolderName ? [s.newFolderName] : []);
            return {
              path: s.isNewFolder ? [...s.path, ...newParts] : s.path,
              isNewFolder: s.isNewFolder || false,
              newFolderPath: s.newFolderPath,
              normalizedConfidence: s.confidence,
            };
          });
          
          const newPathString = currentTargetPath.join(' / ');
          const newFolderIndicator = currentIsNewFolder ? ' [NEW]' : '';
          console.log(`    → ${newPathString}${newFolderIndicator} (${top.confidence}%)`);
          if (currentAlternatives.length > 0) {
            const altNewIndicator = currentAlternatives[0].isNewFolder ? ' [NEW]' : '';
            console.log(`    Alt: ${currentAlternatives[0].path.join(' / ')}${altNewIndicator} (${currentAlternatives[0].normalizedConfidence}%)`);
          }
          console.log(`    (Cost: ${formatCost(usage.estimatedCost)}, Session: ${formatCost(getSessionStats().totalEstimatedCost)})`);
        } else {
          console.log('    Could not interpret destination.');
        }
      } catch (err) {
        console.log(`    (Could not interpret: ${err})`);
      }
      continue;
    }
    
    // Not a peek, summarize, or type command, break out to handle the action
    break;
  }
  
  if (answer.toLowerCase() === 'q') {
    return { action: 'quit' };
  }
  
  if (answer.toLowerCase() === 'n' || answer === '') {
    // Move to Unsorted folder
    const unsortedPath = ['Unsorted'];
    const moveResult = moveFile(currentFilePath, unsortedPath, BASE_PATHS.local, false);
    if (moveResult.success) {
      console.log(`    → Moved to Unsorted`);
      return { action: 'moved', destination: 'Unsorted' };
    } else {
      console.log(`    ⚠️  Couldn't move to Unsorted: ${moveResult.error}`);
      return { action: 'skipped' };
    }
  }

  let chosenPath = currentTargetPath;
  let isNewFolder = currentIsNewFolder;

  if (answer.toLowerCase() === 'y') {
    // Use current target (either original or from [t]ype)
  } else if (['1', '2', '3'].includes(answer)) {
    const altIndex = parseInt(answer, 10) - 1;
    if (altIndex < currentAlternatives.length) {
      const alt = currentAlternatives[altIndex];
      chosenPath = alt.isNewFolder && (alt as any).newFolderName
        ? [...alt.path, (alt as any).newFolderName]
        : alt.path;
      isNewFolder = alt.isNewFolder;
    }
  } else {
    return { action: 'skipped' };
  }

  const moveResult = moveFile(currentFilePath, chosenPath, BASE_PATHS.local, isNewFolder);
  if (moveResult.success) {
    console.log(`    ✓ Moved!`);
    return { action: 'moved', destination: chosenPath.join(' / ') };
  } else {
    console.log(`    ✗ Failed: ${moveResult.error}`);
    return { action: 'error' };
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npm run batch -- <folder-path> [options]');
    console.log('');
    console.log('Scans a folder and classifies each file (non-recursive).');
    console.log('');
    console.log('Options:');
    console.log('  --auto    Automatically move files with high confidence');
    console.log('  --dry     Dry run - show suggestions without moving');
    console.log('');
    console.log('Examples:');
    console.log('  npm run batch -- ~/Downloads');
    console.log('  npm run batch -- ~/Desktop --dry');
    console.log('  npm run batch -- ~/Downloads --auto');
    rl.close();
    process.exit(0);
  }

  const folderPath = args[0];
  const autoMode = args.includes('--auto');
  const dryRun = args.includes('--dry');

  // Validate folder exists
  if (!fs.existsSync(folderPath)) {
    console.error(`Error: Folder not found: ${folderPath}`);
    rl.close();
    process.exit(1);
  }

  const absoluteFolderPath = path.resolve(folderPath);
  const stats = fs.statSync(absoluteFolderPath);

  if (!stats.isDirectory()) {
    console.error('Error: Path is not a folder. Use `npm run classify` for single files.');
    rl.close();
    process.exit(1);
  }

  // Get files (not folders, not hidden)
  const entries = fs.readdirSync(absoluteFolderPath);
  const files = entries.filter((entry) => {
    if (entry.startsWith('.')) return false; // Skip hidden files
    const fullPath = path.join(absoluteFolderPath, entry);
    return fs.statSync(fullPath).isFile();
  });

  if (files.length === 0) {
    console.log('No files found in folder (only checking top-level, non-hidden files).');
    rl.close();
    process.exit(0);
  }

  console.log(`\nFound ${files.length} files in ${absoluteFolderPath}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : autoMode ? 'AUTO' : 'INTERACTIVE'}\n`);

  // Reset session stats
  resetSessionStats();

  const hierarchy = loadHierarchy();

  let moved = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const fullPath = path.join(absoluteFolderPath, file);
    console.log(`\n[${files.indexOf(file) + 1}/${files.length}] ${file}`);

    const result = await classifyAndPrompt(fullPath, hierarchy, dryRun, autoMode);

    if (result.action === 'moved') moved++;
    else if (result.action === 'skipped') skipped++;
    else if (result.action === 'quit') {
      console.log('\nQuitting...');
      break;
    }
    else errors++;
  }

  console.log('\n' + '='.repeat(40));
  console.log(`Done! Moved: ${moved}, Skipped: ${skipped}, Errors: ${errors}`);
  
  // Print usage summary
  printSessionSummary();
  
  rl.close();
}

main().catch((err) => {
  console.error('Error:', err);
  rl.close();
  process.exit(1);
});
