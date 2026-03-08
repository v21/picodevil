import * as acorn from "acorn";
import * as escodegen from "escodegen";

/** Label pattern: optional _ or S prefix, then identifier chars, optional trailing _ */
const LABEL_RE = /^[_S]?[$a-zA-Z]\w*_?$/;

/**
 * Transpile user code: rewrite labeled statements like `$: expr` to `expr.p("$")`.
 * Non-matching statements pass through unchanged.
 */
export function transpile(code: string): string {
  const ast = acorn.parse(code, {
    ecmaVersion: "latest",
    sourceType: "script",
  }) as any;

  for (let i = 0; i < ast.body.length; i++) {
    const node = ast.body[i];
    if (node.type === "LabeledStatement" && LABEL_RE.test(node.label.name)) {
      const label = node.label.name;
      // The body of a labeled ExpressionStatement is the expression
      const bodyExpr =
        node.body.type === "ExpressionStatement"
          ? node.body.expression
          : node.body;

      // Replace the labeled statement with: <expr>.p("<label>")
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

  return escodegen.generate(ast);
}
