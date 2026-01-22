import * as fs from 'fs';
import * as path from 'path';

// Gemini 2.5 Flash Lite pricing (as of early 2025)
// These are approximate - check Google's pricing page for current rates
const PRICING = {
  'gemini-2.5-flash-lite': {
    inputPerMillion: 0.01,   // $0.01 per 1M input tokens
    outputPerMillion: 0.02,  // $0.02 per 1M output tokens
  },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface SessionStats {
  callCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
}

export interface AllTimeStats {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCost: number;
  firstUsed: string;
  lastUsed: string;
}

const STATS_FILE = path.join(__dirname, '..', '.usage-stats.json');

// Session tracking
let sessionStats: SessionStats = {
  callCount: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalEstimatedCost: 0,
};

/**
 * Calculate cost from token counts
 */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  model: string = 'gemini-2.5-flash-lite'
): number {
  const pricing = PRICING[model as keyof typeof PRICING] || PRICING['gemini-2.5-flash-lite'];
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return inputCost + outputCost;
}

/**
 * Track usage from an API response
 */
export function trackUsage(usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number } | undefined): TokenUsage {
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;
  const totalTokens = usageMetadata?.totalTokenCount || inputTokens + outputTokens;
  const estimatedCost = calculateCost(inputTokens, outputTokens);

  // Update session stats
  sessionStats.callCount++;
  sessionStats.totalInputTokens += inputTokens;
  sessionStats.totalOutputTokens += outputTokens;
  sessionStats.totalEstimatedCost += estimatedCost;

  // Update all-time stats
  updateAllTimeStats(inputTokens, outputTokens, estimatedCost);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedCost,
  };
}

/**
 * Get current session stats
 */
export function getSessionStats(): SessionStats {
  return { ...sessionStats };
}

/**
 * Reset session stats (call at start of new session)
 */
export function resetSessionStats(): void {
  sessionStats = {
    callCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalEstimatedCost: 0,
  };
}

/**
 * Load all-time stats from file
 */
export function loadAllTimeStats(): AllTimeStats {
  try {
    if (fs.existsSync(STATS_FILE)) {
      const data = fs.readFileSync(STATS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    // Ignore errors, return default
  }
  return {
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalEstimatedCost: 0,
    firstUsed: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
  };
}

/**
 * Update all-time stats
 */
function updateAllTimeStats(inputTokens: number, outputTokens: number, cost: number): void {
  const stats = loadAllTimeStats();
  stats.totalCalls++;
  stats.totalInputTokens += inputTokens;
  stats.totalOutputTokens += outputTokens;
  stats.totalEstimatedCost += cost;
  stats.lastUsed = new Date().toISOString();

  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch {
    // Ignore write errors
  }
}

/**
 * Format cost for display
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(6)}`;
  } else if (cost < 1) {
    return `$${cost.toFixed(4)}`;
  } else {
    return `$${cost.toFixed(2)}`;
  }
}

/**
 * Print session summary
 */
export function printSessionSummary(): void {
  const session = getSessionStats();
  const allTime = loadAllTimeStats();

  console.log('\n' + '='.repeat(50));
  console.log('API USAGE SUMMARY');
  console.log('='.repeat(50));
  
  console.log('\nThis session:');
  console.log(`  API calls: ${session.callCount}`);
  console.log(`  Tokens: ${session.totalInputTokens.toLocaleString()} in / ${session.totalOutputTokens.toLocaleString()} out`);
  console.log(`  Estimated cost: ${formatCost(session.totalEstimatedCost)}`);

  console.log('\nAll time:');
  console.log(`  API calls: ${allTime.totalCalls.toLocaleString()}`);
  console.log(`  Tokens: ${allTime.totalInputTokens.toLocaleString()} in / ${allTime.totalOutputTokens.toLocaleString()} out`);
  console.log(`  Estimated cost: ${formatCost(allTime.totalEstimatedCost)}`);
  console.log(`  First used: ${new Date(allTime.firstUsed).toLocaleDateString()}`);
}
