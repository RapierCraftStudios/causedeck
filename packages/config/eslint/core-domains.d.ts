// Types for core-domains.js (#293), so TypeScript workspaces without allowJs can import it.
export declare const CORE_DOMAIN_DEPENDENCIES: Readonly<Record<string, readonly string[]>>;
export declare const CORE_DOMAINS: readonly string[];
export declare function findCoreDomainCycle(
  map: Readonly<Record<string, readonly string[]>>,
): string[] | null;
