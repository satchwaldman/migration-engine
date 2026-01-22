import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { loadHierarchy } from './utils/hierarchy';
import { classifyFile, ClassificationResult } from './classifier';
import { moveFile, dryRunMove, BASE_PATHS } from './mover';

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

function printResult(result: ClassificationResult, filename: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`CLASSIFICATION: ${filename}`);
  console.log('='.repeat(60));

  const topPath = result.topChoice.isNewFolder && result.topChoice.newFolderName
    ? [...result.topChoice.path, result.topChoice.newFolderName].join(' / ')
    : result.topChoice.path.join(' / ');

  console.log(`\n  → ${topPath}`);
  console.log(`    Confidence: ${result.topChoice.normalizedConfidence.toFixed(1)}%`);
  
  if (result.topChoice.isNewFolder) {
    console.log(`    (New folder would be created)`);
  }

  if (result.alternatives.length > 0) {
    console.log('\n  Alternatives:');
    result.alternatives.slice(0, 2).forEach((alt, idx) => {
      const altPath = alt.isNewFolder && alt.newFolderName
        ? [...alt.path, alt.newFolderName].join(' / ')
        : alt.path.join(' / ');
      console.log(`    ${idx + 1}. ${altPath} (${alt.normalizedConfidence.toFixed(1)}%)`);
    });
  }

  if (result.needsReview) {
    console.log(`\n  ⚠️  Needs review: ${result.reviewReason}`);
  } else {
    console.log(`\n  ✓ High confidence - auto-move recommended`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: npx ts-node src/classify-file.ts <file-path> [--auto]');
    console.log('');
    console.log('Options:');
    console.log('  --auto    Automatically move files with high confidence (no review needed)');
    console.log('  --dry     Dry run - show what would happen without moving');
    console.log('');
    console.log('Example:');
    console.log('  npx ts-node src/classify-file.ts ~/Downloads/tax_document.pdf');
    rl.close();
    process.exit(0);
  }

  const filePath = args[0];
  const autoMode = args.includes('--auto');
  const dryRun = args.includes('--dry');

  // Validate file exists
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    rl.close();
    process.exit(1);
  }

  const absolutePath = path.resolve(filePath);
  const filename = path.basename(absolutePath);
  const stats = fs.statSync(absolutePath);

  if (stats.isDirectory()) {
    console.error('Error: Cannot classify directories, only files');
    rl.close();
    process.exit(1);
  }

  console.log(`\nAnalyzing: ${filename}`);
  console.log(`Size: ${(stats.size / 1024).toFixed(1)} KB`);

  // Read file content (for text files) or just use filename (for binary)
  let fileContent = '';
  const textExtensions = ['.txt', '.md', '.json', '.js', '.ts', '.py', '.html', '.css', '.csv', '.xml', '.yaml', '.yml'];
  const ext = path.extname(filename).toLowerCase();
  
  if (textExtensions.includes(ext)) {
    try {
      fileContent = fs.readFileSync(absolutePath, 'utf-8');
      // Truncate if too long
      if (fileContent.length > 5000) {
        fileContent = fileContent.substring(0, 5000) + '\n[... truncated ...]';
      }
      console.log(`Content preview: ${fileContent.substring(0, 100).replace(/\n/g, ' ')}...`);
    } catch {
      fileContent = `[Binary or unreadable file: ${filename}]`;
    }
  } else {
    fileContent = `[Non-text file: ${filename}, extension: ${ext}]`;
    console.log('(Non-text file - classifying by filename only)');
  }

  // Load hierarchy and classify
  console.log('\nClassifying...');
  const hierarchy = loadHierarchy();
  
  let result: ClassificationResult;
  try {
    result = await classifyFile(fileContent, filename, hierarchy);
  } catch (err) {
    console.error(`Classification error: ${err}`);
    rl.close();
    process.exit(1);
  }

  printResult(result, filename);

  // Determine action
  const targetPath = result.topChoice.isNewFolder && result.topChoice.newFolderName
    ? [...result.topChoice.path, result.topChoice.newFolderName]
    : result.topChoice.path;

  if (dryRun) {
    const dryResult = dryRunMove(absolutePath, targetPath);
    console.log('\n[DRY RUN]');
    console.log(`  From: ${dryResult.sourcePath}`);
    console.log(`  To:   ${dryResult.destinationPath}`);
    console.log(`  Would succeed: ${dryResult.wouldSucceed ? 'Yes' : 'No - ' + dryResult.issue}`);
    rl.close();
    process.exit(0);
  }

  // Auto mode: move if confident
  if (autoMode && !result.needsReview) {
    console.log('\n[AUTO MODE] Moving file...');
    const moveResult = moveFile(absolutePath, targetPath, BASE_PATHS.local, result.topChoice.isNewFolder);
    if (moveResult.success) {
      console.log(`✓ Moved to: ${moveResult.destinationPath}`);
    } else {
      console.error(`✗ Failed: ${moveResult.error}`);
    }
    rl.close();
    process.exit(moveResult.success ? 0 : 1);
  }

  // Interactive mode
  console.log('');
  const choices = [
    `1. Move to: ${targetPath.join(' / ')}`,
    ...result.alternatives.slice(0, 2).map((alt, idx) => {
      const altPath = alt.isNewFolder && alt.newFolderName
        ? [...alt.path, alt.newFolderName]
        : alt.path;
      return `${idx + 2}. Move to: ${altPath.join(' / ')}`;
    }),
    `${Math.min(result.alternatives.length, 2) + 2}. Skip (don't move)`,
  ];
  
  choices.forEach(c => console.log(`  ${c}`));
  
  const answer = await ask('\nYour choice (1-' + choices.length + '): ');
  const choice = parseInt(answer, 10);

  if (isNaN(choice) || choice < 1 || choice > choices.length) {
    console.log('Invalid choice, skipping.');
    rl.close();
    process.exit(0);
  }

  if (choice === choices.length) {
    console.log('Skipped.');
    rl.close();
    process.exit(0);
  }

  // Determine which path was chosen
  let chosenPath: string[];
  let isNewFolder = false;
  
  if (choice === 1) {
    chosenPath = targetPath;
    isNewFolder = result.topChoice.isNewFolder;
  } else {
    const altIndex = choice - 2;
    const alt = result.alternatives[altIndex];
    chosenPath = alt.isNewFolder && alt.newFolderName
      ? [...alt.path, alt.newFolderName]
      : alt.path;
    isNewFolder = alt.isNewFolder;
  }

  console.log(`\nMoving to: ${chosenPath.join(' / ')}...`);
  const moveResult = moveFile(absolutePath, chosenPath, BASE_PATHS.local, isNewFolder);
  
  if (moveResult.success) {
    console.log(`✓ Done! File is now at: ${moveResult.destinationPath}`);
  } else {
    console.error(`✗ Failed: ${moveResult.error}`);
  }

  rl.close();
}

main().catch((err) => {
  console.error('Error:', err);
  rl.close();
  process.exit(1);
});
