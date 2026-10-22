// Types for core-domain-boundaries.js (#293), so TypeScript workspaces without allowJs can import it.
import type { Rule } from 'eslint';

export type CoreImportProblem =
  'deepImport' | 'undeclaredDependency' | 'sharedImportsDomain' | 'unknownDomain';

export declare function checkCoreImport(
  filename: string,
  specifier: string,
  options?: { isTest?: boolean },
): CoreImportProblem | null;

export declare const coreDomainBoundaries: Rule.RuleModule;
