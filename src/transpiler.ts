import * as acorn from "acorn";
import * as escodegen from "escodegen";

/** Label pattern: optional _ or S prefix, then identifier chars, optional trailing _ */
const LABEL_RE = /^[_S]?[$a-zA-Z]\w*_?$/;

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

/** Walk AST and collect widget call info. */
function extractWidgets(node: any, widgets: WidgetCallInfo[]): void {
  if (!node || typeof node !== "object") return;

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
        valueArgStart: firstArg.start,
        valueArgEnd: firstArg.end,
        args,
      });
    }
  }

  // Recurse into all properties
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "raw" || key === "start" || key === "end") continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        extractWidgets(item, widgets);
      }
    } else if (val && typeof val === "object" && val.type) {
      extractWidgets(val, widgets);
    }
  }
}

/**
 * Transpile user code:
 * 1. Rewrite labeled statements like `$: expr` to `expr.p("$")`
 * 2. Rewrite double-quoted strings to mini() calls (single-quoted strings pass through)
 * 3. Extract widget call positions (slider, etc.)
 */
export function transpile(code: string): TranspileResult {
  const ast = acorn.parse(code, {
    ecmaVersion: "latest",
    sourceType: "script",
  }) as any;

  // Extract widget positions before any AST rewrites (positions refer to original source)
  const widgets: WidgetCallInfo[] = [];
  extractWidgets(ast, widgets);

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

  return {
    code: escodegen.generate(ast),
    widgets,
  };
}
