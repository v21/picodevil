import * as acorn from "acorn";
import * as escodegen from "escodegen";

/** Label pattern: optional _ or S prefix, then identifier chars, optional trailing _ */
const LABEL_RE = /^[_S]?[$a-zA-Z]\w*_?$/;

/** Wrap a string literal AST node in a mini() call. */
function wrapInMini(node: any): any {
  return {
    type: "CallExpression",
    callee: { type: "Identifier", name: "mini" },
    arguments: [{ type: "Literal", value: node.value }],
  };
}

/** Walk AST and replace double-quoted string literals with mini() calls. */
function rewriteDoubleQuotedStrings(node: any, source: string): any {
  if (!node || typeof node !== "object") return node;

  // Check if this is a double-quoted string literal
  if (node.type === "Literal" && typeof node.value === "string" && node.raw?.startsWith('"')) {
    return wrapInMini(node);
  }

  // Recurse into all properties
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "raw" || key === "start" || key === "end") continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        val[i] = rewriteDoubleQuotedStrings(val[i], source);
      }
    } else if (val && typeof val === "object" && val.type) {
      node[key] = rewriteDoubleQuotedStrings(val, source);
    }
  }
  return node;
}

/**
 * Transpile user code:
 * 1. Rewrite labeled statements like `$: expr` to `expr.p("$")`
 * 2. Rewrite double-quoted strings to mini() calls (single-quoted strings pass through)
 */
export function transpile(code: string): string {
  const ast = acorn.parse(code, {
    ecmaVersion: "latest",
    sourceType: "script",
  }) as any;

  // Rewrite labels
  for (let i = 0; i < ast.body.length; i++) {
    const node = ast.body[i];
    if (node.type === "LabeledStatement" && LABEL_RE.test(node.label.name)) {
      const label = node.label.name;
      const bodyExpr =
        node.body.type === "ExpressionStatement"
          ? node.body.expression
          : node.body;

      ast.body[i] = {
        type: "ExpressionStatement",
        expression: {
          type: "CallExpression",
          callee: {
            type: "MemberExpression",
            object: bodyExpr,
            property: { type: "Identifier", name: "p" },
            computed: false,
          },
          arguments: [{ type: "Literal", value: label }],
        },
      };
    }
  }

  // Rewrite double-quoted strings to mini() calls
  rewriteDoubleQuotedStrings(ast, code);

  return escodegen.generate(ast);
}
