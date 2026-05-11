import * as acorn from "acorn";
import * as escodegen from "escodegen";

/** Label pattern: optional _, S, or H prefix, then identifier chars, optional trailing _ */
const LABEL_RE = /^[_SH]?[$a-zA-Z]\w*_?$/;

/** Widget function names we extract positions for */
const WIDGET_FUNCTIONS = new Set(["slider"]);

export interface WidgetCallInfo {
  kind: "slider";
  callStart: number;     // source offset of full call expression
  callEnd: number;
  valueArgStart: number; // source offset of first argument (the value)
  valueArgEnd: number;
  args: number[];        // parsed numeric arguments
}

export interface TranspileResult {
  code: string;
  widgets: WidgetCallInfo[];
}

/**
 * Walk the AST in-place and normalize Identifier names to canonical case using normMap.
 * String literals and comments are never Identifier nodes, so filenames/CSS values are safe.
 */
function normalizeIdentifiers(node: any, normMap: Map<string, string>): void {
  if (!node || typeof node !== "object") return;
  if (node.type === "Identifier") {
    const canonical = normMap.get(node.name.toLowerCase());
    if (canonical && canonical !== node.name) node.name = canonical;
    return;
  }
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "raw" || key === "start" || key === "end") continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const child of val) normalizeIdentifiers(child, normMap);
    } else if (val && typeof val === "object" && val.type) {
      normalizeIdentifiers(val, normMap);
    }
  }
}

/** Wrap a string literal AST node in a mini() call. */
function wrapInMini(node: any): any {
  return {
    type: "CallExpression",
    callee: { type: "Identifier", name: "mini" },
    arguments: [{ type: "Literal", value: node.value }],
  };
}

/**
 * Single-pass AST walker that:
 * 1. Collects widget call positions (using original source offsets, before any rewriting)
 * 2. Rewrites double-quoted string literals to mini() calls in-place
 * Returns the (possibly replaced) node.
 */
function walkAST(node: any, widgets: WidgetCallInfo[]): any {
  if (!node || typeof node !== "object") return node;

  // Double-quoted string → wrap in mini() (return a new node; caller must reassign)
  if (node.type === "Literal" && typeof node.value === "string" && node.raw?.startsWith('"')) {
    return wrapInMini(node);
  }

  // Widget call: capture positions from original node before recursing into children
  if (
    node.type === "CallExpression" &&
    node.callee?.type === "Identifier" &&
    WIDGET_FUNCTIONS.has(node.callee.name)
  ) {
    const kind = node.callee.name as "slider";
    const args: number[] = [];
    for (const arg of node.arguments) {
      if (arg.type === "Literal" && typeof arg.value === "number") {
        args.push(arg.value);
      } else if (arg.type === "UnaryExpression" && arg.operator === "-" && arg.argument?.type === "Literal" && typeof arg.argument.value === "number") {
        args.push(-arg.argument.value);
      }
    }
    const firstArg = node.arguments[0];
    if (firstArg) {
      widgets.push({
        kind,
        callStart: node.start,
        callEnd: node.end,
        valueArgStart: firstArg.start,  // original offset — captured before child rewriting
        valueArgEnd: firstArg.end,
        args,
      });
    }
  }

  // Recurse into all child properties, replacing nodes that the walker returns new values for
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "raw" || key === "start" || key === "end") continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        val[i] = walkAST(val[i], widgets);
      }
    } else if (val && typeof val === "object" && val.type) {
      node[key] = walkAST(val, widgets);
    }
  }
  return node;
}

/**
 * Transpile user code:
 * 1. Rewrite labeled statements like `$: expr` to `expr.p("$")`
 * 2. Normalize identifier case using normMap (if provided)
 * 3. Rewrite double-quoted strings to mini() calls (single-quoted strings pass through)
 * 4. Extract widget call positions (slider, etc.)
 */
export function transpile(code: string, normMap?: Map<string, string>): TranspileResult {
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

  // Normalize identifier case (runs after label rewriting so .p() calls are canonical)
  if (normMap) normalizeIdentifiers(ast, normMap);

  // Single pass: collect widget positions and rewrite double-quoted strings to mini() calls
  const widgets: WidgetCallInfo[] = [];
  walkAST(ast, widgets);

  return {
    code: escodegen.generate(ast),
    widgets,
  };
}
