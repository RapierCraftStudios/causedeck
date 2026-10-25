// Entrypoint of the freeze-guard action (#100). Reads the runner's clock (never an input), writes
// the outputs and fails the job inside a freeze unless the caller is the audited hotfix path.
import { appendFileSync } from 'node:fs';
import { evaluateFreeze } from './freeze.ts';

export interface RunResult {
  readonly exitCode: number;
  readonly outputs: Record<string, string>;
  readonly message: string;
}

export function run(now: Date, allowOverride: boolean): RunResult {
  const result = evaluateFreeze(now);
  const outputs = {
    frozen: String(result.frozen),
    window_name: result.windowName,
    next_open_at_ist: result.nextOpenAtIst,
  };
  if (!result.frozen) {
    return {
      exitCode: 0,
      outputs,
      message: `No court-day freeze (next freeze ${result.nextFreezeAtIst}).`,
    };
  }
  if (allowOverride) {
    return {
      exitCode: 0,
      outputs,
      message: `Court-day freeze (${result.windowName}) bypassed by the hotfix override; next open window ${result.nextOpenAtIst}.`,
    };
  }
  return {
    exitCode: 1,
    outputs,
    message: `Production deploys are frozen for ${result.windowName} (court-day freeze). Next open window: ${result.nextOpenAtIst}. P0 incidents use the hotfix workflow.`,
  };
}

/* eslint-disable no-process-env -- action entrypoint: inputs and GITHUB_OUTPUT arrive via the environment */
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const outcome = run(new Date(), process.env.INPUT_ALLOW_OVERRIDE === 'true');
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    for (const [key, value] of Object.entries(outcome.outputs))
      appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(
    outcome.exitCode === 0 ? outcome.message : `::error title=Court-day freeze::${outcome.message}`,
  );
  process.exit(outcome.exitCode);
}
