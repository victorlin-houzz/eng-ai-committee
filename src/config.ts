import type { Config } from './types.js';

const DEFAULT_CONFIG: Omit<Config, 'apiKey'> = {
  specialistModel: 'gpt-5.4',           // Parallel specialist review — strong document understanding
  judgeModel: 'gpt-5.4-pro',            // Final verdict synthesis — deeper reasoning for complex determinations
  skepticModel: 'gpt-5.4',              // Adversarial challenge + rebuttal rating
  dedupModel: 'gpt-5.4-nano',           // Dedup + structural pre-check — simple high-throughput tasks
  maxDebateRounds: 1,
};

export function loadConfig(depthOverride?: number): Config {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is not set.');
    process.exit(1);
  }
  return {
    ...DEFAULT_CONFIG,
    maxDebateRounds: depthOverride ?? DEFAULT_CONFIG.maxDebateRounds,
    apiKey,
  };
}
