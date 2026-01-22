import { GoogleGenerativeAI } from '@google/generative-ai';
import { Hierarchy, hierarchyToString } from './utils/hierarchy';
import { trackUsage } from './usage-tracker';

export interface FolderSuggestion {
  path: string[];           // e.g., ["Free Time", "Personal Projects", "Technical Projects"]
  newFolderName?: string;   // e.g., "Insulin Monitor Project" (only if isNewFolder)
  isNewFolder: boolean;
  confidence: number;       // 0-100
}

export interface TrialResult {
  suggestions: FolderSuggestion[];
  rawResponse: string;
}

export interface ClassificationResult {
  topChoice: {
    path: string[];
    newFolderName?: string;
    isNewFolder: boolean;
    normalizedConfidence: number;  // 0-100, after aggregation
  };
  alternatives: {
    path: string[];
    newFolderName?: string;
    isNewFolder: boolean;
    normalizedConfidence: number;
  }[];
  isDominant: boolean;      // true if both conditions met
  needsReview: boolean;     // true if NOT dominant
  reviewReason?: string;    // "low absolute confidence" or "close alternatives" or both
  rawTrials: TrialResult[]; // the 3 individual API responses for debugging
}

/**
 * Makes a single classification trial with the LLM
 */
async function makeTrial(
  fileContent: string,
  filename: string,
  hierarchy: Hierarchy,
  genAI: GoogleGenerativeAI
): Promise<TrialResult> {
  const hierarchyText = hierarchyToString(hierarchy);

  const prompt = `You are a file classification assistant. Your task is to classify a file into the provided folder hierarchy.

Folder Hierarchy:
${hierarchyText}

File to classify:
- Filename: ${filename}
- Content:
${fileContent}

Instructions:
1. Analyze the file's content and filename to determine where it belongs in the hierarchy
2. Return your best guess for which folder this file belongs in, along with a confidence percentage (0-100). Only return folders you're genuinely confident about.
3. You can return 1-5 folder suggestions, but only include folders that are actually plausible. Don't force yourself to suggest folders that don't fit.
4. If no existing folder fits well, you may suggest creating a new folder by providing the parent path and a suggested new folder name.

Return a JSON array of suggestions, where each suggestion has this structure:
{
  "path": ["folder1", "folder2", "folder3"],
  "newFolderName": "Optional new folder name if isNewFolder is true",
  "isNewFolder": false,
  "confidence": 85
}

The "path" should be an array of folder names representing the full path from root to the target folder (or parent folder if creating new).
If suggesting a new folder, set "isNewFolder" to true and provide "newFolderName" with the suggested name.
The "confidence" should be a number from 0-100 representing how confident you are in this suggestion.

Return only the JSON array, no additional text.`;

  try {
    // Create model instance with temperature configured for this trial
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: {
        temperature: 0.7,
      },
    });
    
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    
    // Track API usage
    trackUsage(response.usageMetadata);

    // Extract JSON from the response (handle cases where LLM adds markdown code blocks)
    let jsonText = text.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const suggestions = JSON.parse(jsonText) as FolderSuggestion[];

    // Validate the result structure
    if (!Array.isArray(suggestions)) {
      throw new Error('Invalid response: expected an array of suggestions');
    }

    // Validate and normalize each suggestion
    for (const suggestion of suggestions) {
      if (!Array.isArray(suggestion.path)) {
        throw new Error('Invalid response: path must be an array');
      }
      // Default isNewFolder to false if missing
      if (typeof suggestion.isNewFolder !== 'boolean') {
        suggestion.isNewFolder = false;
      }
      if (typeof suggestion.confidence !== 'number' || suggestion.confidence < 0 || suggestion.confidence > 100) {
        throw new Error('Invalid response: confidence must be a number between 0 and 100');
      }
      if (suggestion.isNewFolder && !suggestion.newFolderName) {
        throw new Error('Invalid response: newFolderName is required when isNewFolder is true');
      }
    }

    return {
      suggestions,
      rawResponse: text,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Failed to parse LLM response as JSON: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Creates a unique key for a folder path suggestion
 */
function getPathKey(path: string[], newFolderName?: string, isNewFolder?: boolean): string {
  if (isNewFolder && newFolderName) {
    return JSON.stringify([...path, `NEW:${newFolderName}`]);
  }
  return JSON.stringify(path);
}

/**
 * Aggregates suggestions from multiple trials
 */
function aggregateSuggestions(trials: TrialResult[]): Map<string, {
  path: string[];
  newFolderName?: string;
  isNewFolder: boolean;
  totalConfidence: number;
  count: number;
}> {
  const aggregated = new Map<string, {
    path: string[];
    newFolderName?: string;
    isNewFolder: boolean;
    totalConfidence: number;
    count: number;
  }>();

  for (const trial of trials) {
    for (const suggestion of trial.suggestions) {
      const key = getPathKey(suggestion.path, suggestion.newFolderName, suggestion.isNewFolder);
      
      if (aggregated.has(key)) {
        const existing = aggregated.get(key)!;
        existing.totalConfidence += suggestion.confidence;
        existing.count += 1;
      } else {
        aggregated.set(key, {
          path: suggestion.path,
          newFolderName: suggestion.newFolderName,
          isNewFolder: suggestion.isNewFolder,
          totalConfidence: suggestion.confidence,
          count: 1,
        });
      }
    }
  }

  return aggregated;
}

/**
 * Normalizes confidence scores so they sum to 100%
 */
function normalizeConfidences(
  aggregated: Map<string, {
    path: string[];
    newFolderName?: string;
    isNewFolder: boolean;
    totalConfidence: number;
    count: number;
  }>
): Array<{
  path: string[];
  newFolderName?: string;
  isNewFolder: boolean;
  normalizedConfidence: number;
  count: number;
}> {
  const totalConfidence = Array.from(aggregated.values()).reduce(
    (sum, item) => sum + item.totalConfidence,
    0
  );

  if (totalConfidence === 0) {
    return [];
  }

  return Array.from(aggregated.entries())
    .map(([key, item]) => ({
      path: item.path,
      newFolderName: item.newFolderName,
      isNewFolder: item.isNewFolder,
      normalizedConfidence: (item.totalConfidence / totalConfidence) * 100,
      count: item.count,
    }))
    .sort((a, b) => b.normalizedConfidence - a.normalizedConfidence);
}

/**
 * Checks if a new folder was suggested in multiple trials
 */
function isNewFolderSuggestedMultipleTimes(
  normalized: Array<{
    path: string[];
    newFolderName?: string;
    isNewFolder: boolean;
    normalizedConfidence: number;
    count: number;
  }>,
  trials: TrialResult[]
): boolean {
  const newFolderSuggestions = normalized.filter(n => n.isNewFolder);
  if (newFolderSuggestions.length === 0) {
    return false;
  }

  // Check if any new folder suggestion appears in 2+ trials
  return newFolderSuggestions.some(n => n.count >= 2);
}

/**
 * Classifies a file into the folder hierarchy using multi-trial classification with Gemini Flash API
 * @param fileContent The content of the file
 * @param filename The name of the file
 * @param hierarchy The folder hierarchy JSON
 * @returns Classification result with topChoice, alternatives, dominance info, and review flags
 */
export async function classifyFile(
  fileContent: string,
  filename: string,
  hierarchy: Hierarchy
): Promise<ClassificationResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  // Make trials until we get 3 successful ones (max 6 attempts to avoid infinite loops)
  const trials: TrialResult[] = [];
  let attempts = 0;
  const maxAttempts = 6;
  
  while (trials.length < 3 && attempts < maxAttempts) {
    attempts++;
    try {
      const trial = await makeTrial(fileContent, filename, hierarchy, genAI);
      trials.push(trial);
    } catch (err) {
      // Trial failed, will retry automatically
    }
  }

  if (trials.length === 0) {
    throw new Error('All classification trials failed');
  }

  // Aggregate suggestions
  const aggregated = aggregateSuggestions(trials);
  const normalized = normalizeConfidences(aggregated);

  if (normalized.length === 0) {
    throw new Error('No valid suggestions received from any trial');
  }

  const topChoice = normalized[0];
  const alternatives = normalized.slice(1);

  // Check for new folder suggestions
  const hasNewFolderInSingleTrial = normalized.some(
    n => n.isNewFolder && n.count === 1
  );
  const newFolderSuggestedMultipleTimes = isNewFolderSuggestedMultipleTimes(normalized, trials);

  // Dominance check: both conditions must be met
  const absoluteThreshold = topChoice.normalizedConfidence >= 50;
  const relativeDominance = alternatives.length === 0 || 
    topChoice.normalizedConfidence >= 2 * alternatives[0].normalizedConfidence;

  // New folder handling: always needs review unless suggested in all 3 trials with high confidence
  const newFolderNeedsReview = topChoice.isNewFolder && 
    (!newFolderSuggestedMultipleTimes || topChoice.count < 3 || topChoice.normalizedConfidence < 50);

  const isDominant = absoluteThreshold && relativeDominance && !newFolderNeedsReview && !hasNewFolderInSingleTrial;
  const needsReview = !isDominant;

  // Build review reason
  const reviewReasons: string[] = [];
  if (!absoluteThreshold) {
    reviewReasons.push('low absolute confidence');
  }
  if (!relativeDominance && alternatives.length > 0) {
    reviewReasons.push('close alternatives');
  }
  if (newFolderNeedsReview) {
    reviewReasons.push('new folder suggestion needs verification');
  }
  if (hasNewFolderInSingleTrial) {
    reviewReasons.push('new folder suggested in only one trial');
  }

  return {
    topChoice: {
      path: topChoice.path,
      newFolderName: topChoice.newFolderName,
      isNewFolder: topChoice.isNewFolder,
      normalizedConfidence: topChoice.normalizedConfidence,
    },
    alternatives: alternatives.map(alt => ({
      path: alt.path,
      newFolderName: alt.newFolderName,
      isNewFolder: alt.isNewFolder,
      normalizedConfidence: alt.normalizedConfidence,
    })),
    isDominant,
    needsReview,
    reviewReason: reviewReasons.length > 0 ? reviewReasons.join('; ') : undefined,
    rawTrials: trials,
  };
}
