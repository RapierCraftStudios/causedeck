import node from '@causedeck/config/eslint/node';
import { fetchLayerOverride } from '@causedeck/config/eslint/base';

// Globs are relative to this package when ESLint runs from it, so the base `**/packages/fetch/**`
// override does not match here; repeat it for the package's own files.
export default [...node, fetchLayerOverride(['**/*.ts'])];
