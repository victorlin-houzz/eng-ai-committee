#!/usr/bin/env node
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from './config.js';
import { initClient } from './pipeline/agents/base.js';
import { parseDocument } from './parsers/index.js';
import { runPipeline } from './pipeline/orchestrator.js';
import { runRevision } from './pipeline/revision.js';
import { clearCheckpoint, checkpointPath } from './pipeline/checkpoint.js';
import { printJson, printResult, printRevisionResult } from './output/stdout.js';

const program = new Command();

program
  .name('review-gate')
  .description('Multi-agent design doc review gate for engineering committees')
  .version('0.1.0')
  .argument('<file>', 'Design doc to review (PDF, Markdown, plain text, or DOCX)')
  .option('--agents <list>', 'Specialist filter: all | security-compliance | architecture-infra | product-ops (comma-separated)', 'all')
  .option('--depth <n>', 'Debate rounds: 1 (default) or 2 (thorough)', '1')
  .option('--revise', 'After review, produce a revised doc agreed by all specialists')
  .option('--reset', 'Ignore any existing checkpoint and start the pipeline from scratch')
  .option('--json', 'Output raw JSON instead of formatted text')
  .action(async (
    file: string,
    options: { agents: string; depth: string; revise: boolean; reset: boolean; json: boolean },
  ) => {
    const depth = parseInt(options.depth, 10);
    if (isNaN(depth) || depth < 1 || depth > 2) {
      console.error('Error: --depth must be 1 or 2');
      process.exit(1);
    }

    const config = loadConfig(depth);
    initClient(config.apiKey);

    // Clear checkpoint if --reset was passed
    if (options.reset) {
      await clearCheckpoint(checkpointPath(file));
      console.log('Checkpoint cleared. Starting fresh.');
    }

    const spinner = ora('Parsing document...').start();

    try {
      const docText = await parseDocument(file);
      spinner.succeed(`Document parsed (${docText.length.toLocaleString()} characters)`);

      const runSpinner = ora('Starting pipeline...').start();

      const result = await runPipeline(
        docText,
        config,
        options.agents,
        file,
        (message) => { runSpinner.text = message; },
      );

      runSpinner.stop();

      if (result.resumedFromCheckpoint) {
        console.log(`(Resumed from checkpoint — use --reset to start fresh)\n`);
      }

      if (options.json) {
        printJson(result);
      } else {
        printResult(result);
      }

      // Clear checkpoint on successful complete run
      await clearCheckpoint(checkpointPath(file));

      // Revision workflow
      if (options.revise) {
        const survivingFindings = result.verdict.topBlockingIssues.length > 0
          ? result.verdict.topBlockingIssues
          : result.allFindings.filter((f) => f.severity === 'High' || f.severity === 'Critical');

        const revSpinner = ora('Starting revision...').start();
        const revision = await runRevision(
          docText,
          survivingFindings,
          config,
          file,
          (message) => { revSpinner.text = message; },
        );
        revSpinner.stop();

        if (options.json) {
          console.log(JSON.stringify(revision, null, 2));
        } else {
          printRevisionResult(revision);
        }
      }

      if (result.verdict.verdict === 'Reject') process.exit(2);
      if (result.verdict.verdict === 'Revise') process.exit(1);
    } catch (err) {
      spinner.fail('Pipeline failed');
      console.error(err instanceof Error ? err.message : String(err));
      console.error('\nCheckpoint saved. Re-run the same command to resume from the last completed stage.');
      process.exit(3);
    }
  });

program.parse();
