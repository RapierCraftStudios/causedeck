// `causedeck/require-authorization` (#235, spike §4.1): every server action and `/v1` route must
// authorize. A server action (an export of a `'use server'` module, or a function with its own
// `'use server'` directive) must reach `assertCan`, `guard`, `authorize` or `workspaceAction`,
// directly or through a module-level binding. A `/v1` route (`defineRoute` / `createRoute` in
// `routes/v1/*.ts`) must list `authorize(action)` in its `middleware`. Either may instead carry a
// reviewed `// authz: public <reason>` comment. Syntax only: no type information needed.

/** Calls that authorize (apps/web/lib/guard.ts, workspace-action.ts, apps/api authorize.ts). */
const CHECKS = new Set(['assertCan', 'guard', 'authorize', 'workspaceAction']);
const ROUTE_FACTORIES = new Set(['defineRoute', 'createRoute']);
const PUBLIC_ANNOTATION = /^\s*\*?\s*authz:\s*public\b/;
const ROUTE_FILE = /(^|\/)routes\/v1\/[^/]+\.[cm]?[jt]sx?$/;

/** @typedef {import('estree').Node} Node */
/** @typedef {import('eslint').Rule.RuleContext} RuleContext */

/** @param {Node | null | undefined} node */
const isFunction = (node) =>
  node?.type === 'FunctionDeclaration' ||
  node?.type === 'FunctionExpression' ||
  node?.type === 'ArrowFunctionExpression';

/** @param {Node[]} body */
function hasUseServer(body) {
  for (const statement of body) {
    const directive = statement.type === 'ExpressionStatement' ? statement.directive : undefined;
    if (typeof directive !== 'string') return false;
    if (directive === 'use server') return true;
  }
  return false;
}

/** @param {Node} node */
function calleeName(node) {
  if (node.type !== 'CallExpression') return null;
  const { callee } = node;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
export const requireAuthorization = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Server actions and /v1 routes must authorize (assertCan, guard, workspaceAction or authorize), or be annotated `// authz: public`.',
      url: 'https://github.com/RapierCraftStudios/lawyer-os/blob/main/docs/engineering/permissions.md#enforcement',
    },
    schema: [],
    messages: {
      missingServerAction:
        'Server action `{{name}}` must authorize: use `workspaceAction` / `guard` or call `assertCan`, or annotate it `// authz: public <reason>`.',
      missingRoute:
        'This /v1 route must authorize: add `authorize(action)` to its `middleware`, or annotate it `// authz: public <reason>`.',
    },
  },

  create(context) {
    const { sourceCode } = context;
    const filename = context.filename.replaceAll('\\', '/');

    /** @type {Map<string, Node>} Module-level bindings: name → function or initializer. */
    const bindings = new Map();
    /** @type {Map<string, Node>} Module-level binding name → its top-level statement. */
    const statements = new Map();

    /** @param {Node} node */
    const annotated = (node) =>
      sourceCode.getCommentsBefore(node).some((comment) => PUBLIC_ANNOTATION.test(comment.value));

    /** True when `node` or an enclosing statement carries `// authz: public`. */
    function annotatedUpwards(/** @type {Node} */ node) {
      for (const ancestor of [node, ...sourceCode.getAncestors(node).reverse()]) {
        if (ancestor.type === 'Program') return false;
        if (/(Statement|Declaration)$/.test(ancestor.type) && annotated(ancestor)) return true;
      }
      return false;
    }

    /** True when `node` calls a check, directly or through module-level bindings. */
    function reachesCheck(/** @type {Node} */ node, seen = new Set()) {
      /** @type {Node[]} */
      const stack = [node];
      while (stack.length > 0) {
        const current = /** @type {Node} */ (stack.pop());
        const name = calleeName(current);
        if (name !== null && CHECKS.has(name)) return true;
        const target =
          current.type === 'CallExpression' && current.callee.type === 'Identifier'
            ? current.callee.name
            : null;
        if (target !== null && !seen.has(target) && bindings.has(target)) {
          seen.add(target);
          stack.push(/** @type {Node} */ (bindings.get(target)));
        }
        const keys = sourceCode.visitorKeys[current.type] ?? [];
        for (const key of keys) {
          /** @type {unknown} */
          const child = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (current))[
            key
          ];
          for (const item of Array.isArray(child) ? child : [child]) {
            if (item !== null && typeof item === 'object' && 'type' in item) {
              stack.push(/** @type {Node} */ (item));
            }
          }
        }
      }
      return false;
    }

    /**
     * Report an exported server action that neither authorizes nor is annotated.
     * @param {Node} target the function, initializer or identifier the export resolves to
     * @param {Node[]} statementsToCheck statements whose leading comments may annotate it
     * @param {Node} reportOn
     * @param {string} name
     */
    function checkAction(target, statementsToCheck, reportOn, name) {
      if (statementsToCheck.some(annotated)) return;
      if (reachesCheck(target)) return;
      context.report({ node: reportOn, messageId: 'missingServerAction', data: { name } });
    }

    /** @param {import('estree').Program} program */
    function collectBindings(program) {
      for (const statement of program.body) {
        const declaration =
          (statement.type === 'ExportNamedDeclaration' ||
            statement.type === 'ExportDefaultDeclaration') &&
          statement.declaration
            ? statement.declaration
            : statement;
        if (declaration.type === 'FunctionDeclaration' && declaration.id) {
          bindings.set(declaration.id.name, declaration);
          statements.set(declaration.id.name, statement);
        } else if (declaration.type === 'VariableDeclaration') {
          for (const declarator of declaration.declarations) {
            if (declarator.id.type === 'Identifier' && declarator.init) {
              bindings.set(declarator.id.name, declarator.init);
              statements.set(declarator.id.name, statement);
            }
          }
        }
      }
    }

    /** @param {import('estree').Program} program */
    function checkServerModule(program) {
      for (const statement of program.body) {
        if (statement.type === 'ExportDefaultDeclaration') {
          const { declaration } = statement;
          const name =
            declaration.type === 'FunctionDeclaration' && declaration.id
              ? declaration.id.name
              : 'default';
          checkAction(/** @type {Node} */ (declaration), [statement], statement, name);
          continue;
        }
        if (statement.type !== 'ExportNamedDeclaration' || statement.exportKind === 'type') {
          continue;
        }
        const { declaration } = statement;
        if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
          checkAction(declaration, [statement], declaration.id, declaration.id.name);
        } else if (declaration?.type === 'VariableDeclaration') {
          for (const declarator of declaration.declarations) {
            if (declarator.id.type !== 'Identifier' || !declarator.init) continue;
            checkAction(declarator.init, [statement], declarator.id, declarator.id.name);
          }
        } else if (!declaration && !statement.source) {
          for (const specifier of statement.specifiers) {
            if (specifier.exportKind === 'type' || specifier.local.type !== 'Identifier') continue;
            const local = specifier.local.name;
            const target = bindings.get(local);
            // Imported bindings are actions of the module that defines them.
            if (!target) continue;
            const owner = statements.get(local);
            checkAction(target, owner ? [statement, owner] : [statement], specifier, local);
          }
        }
      }
    }

    /** A function with its own `'use server'` directive (an inline server action). */
    function checkInlineAction(/** @type {Node} */ node) {
      if (!isFunction(node)) return;
      const fn = /** @type {import('estree').Function} */ (node);
      if (fn.body.type !== 'BlockStatement' || !hasUseServer(fn.body.body)) return;
      if (annotatedUpwards(node)) return;
      if (reachesCheck(fn.body)) return;
      const id = 'id' in fn && fn.id ? fn.id : null;
      context.report({
        node: id ?? node,
        messageId: 'missingServerAction',
        data: { name: id?.name ?? '(inline)' },
      });
    }

    let serverModule = false;

    return {
      Program(program) {
        serverModule = hasUseServer(program.body);
        collectBindings(program);
        if (serverModule) checkServerModule(program);
      },
      ':function'(/** @type {Node} */ node) {
        // In a `'use server'` module the exports are checked as actions already.
        if (!serverModule) checkInlineAction(node);
      },
      CallExpression(node) {
        if (!ROUTE_FILE.test(filename)) return;
        if (node.callee.type !== 'Identifier' || !ROUTE_FACTORIES.has(node.callee.name)) return;
        const [config] = node.arguments;
        if (config?.type === 'ObjectExpression') {
          const middleware = config.properties.find(
            (property) =>
              property.type === 'Property' &&
              !property.computed &&
              property.key.type === 'Identifier' &&
              property.key.name === 'middleware',
          );
          if (middleware?.type === 'Property' && containsAuthorize(middleware.value)) return;
        }
        if (annotatedUpwards(node)) return;
        context.report({ node, messageId: 'missingRoute' });
      },
    };

    /** True when the middleware expression lists an `authorize(...)` call. */
    function containsAuthorize(/** @type {Node} */ node) {
      if (node.type === 'CallExpression') {
        return node.callee.type === 'Identifier' && node.callee.name === 'authorize';
      }
      if (node.type === 'ArrayExpression') {
        return node.elements.some(
          (element) => element !== null && element.type !== 'SpreadElement' && containsAuthorize(element),
        );
      }
      return false;
    }
  },
};

export default requireAuthorization;
