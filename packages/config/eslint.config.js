import { node } from './eslint/node.js';

export default [...node, { ignores: ['eslint/__fixtures__/**'] }];
