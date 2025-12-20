import 'dotenv/config';
import { loadHierarchy } from './utils/hierarchy';
import { classifyFile } from './classifier';

async function main() {
  try {
    console.log('Loading hierarchy...');
    const hierarchy = loadHierarchy();
    console.log('Hierarchy loaded successfully.\n');

    // Test case: insulin monitor notes
    const testFilename = 'insulin_monitor_notes.md';
    const testContent = `Ideas for an ambulatory insulin monitoring device. This device would track blood glucose levels continuously and provide alerts when levels are outside the normal range. It would integrate with a mobile app to provide real-time monitoring and historical data analysis.`;

    console.log('Classifying file:');
    console.log(`  Filename: ${testFilename}`);
    console.log(`  Content: ${testContent.substring(0, 100)}...\n`);

    console.log('Running 3 classification trials...\n');
    const result = await classifyFile(testContent, testFilename, hierarchy);

    console.log('='.repeat(60));
    console.log('CLASSIFICATION RESULT');
    console.log('='.repeat(60));
    
    console.log('\nTop Choice:');
    const topPath = result.topChoice.isNewFolder && result.topChoice.newFolderName
      ? [...result.topChoice.path, result.topChoice.newFolderName].join(' / ')
      : result.topChoice.path.join(' / ');
    console.log(`  Path: ${topPath}`);
    console.log(`  Is New Folder: ${result.topChoice.isNewFolder}`);
    console.log(`  Confidence: ${result.topChoice.normalizedConfidence.toFixed(1)}%`);

    if (result.alternatives.length > 0) {
      console.log('\nAlternatives:');
      result.alternatives.slice(0, 3).forEach((alt, idx) => {
        const altPath = alt.isNewFolder && alt.newFolderName
          ? [...alt.path, alt.newFolderName].join(' / ')
          : alt.path.join(' / ');
        console.log(`  ${idx + 1}. ${altPath} (${alt.normalizedConfidence.toFixed(1)}%)`);
      });
    }

    console.log('\nDominance Analysis:');
    console.log(`  Is Dominant: ${result.isDominant}`);
    console.log(`  Needs Review: ${result.needsReview}`);
    if (result.reviewReason) {
      console.log(`  Review Reason: ${result.reviewReason}`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('RAW TRIALS (for debugging)');
    console.log('='.repeat(60));
    result.rawTrials.forEach((trial, idx) => {
      console.log(`\nTrial ${idx + 1}:`);
      trial.suggestions.forEach((suggestion, sIdx) => {
        const path = suggestion.isNewFolder && suggestion.newFolderName
          ? [...suggestion.path, suggestion.newFolderName].join(' / ')
          : suggestion.path.join(' / ');
        console.log(`  ${sIdx + 1}. ${path} - Confidence: ${suggestion.confidence}%`);
      });
    });
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

main();
