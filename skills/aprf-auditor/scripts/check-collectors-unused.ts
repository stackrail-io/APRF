/**
 * Fail CI when collector sources have unused locals/params or useless
 * initial assignments (the github-code-quality / CodeQL class that
 * `noUnusedLocals` alone does not catch).
 *
 * Run from repo root: npm run aprf:collectors:unused
 */
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const UNUSED_DIAG_CODES = new Set([
  6133, // declared but its value is never read
  6192, // All imports in import declaration are unused
  6196, // declared but never used (type-only)
  6198, // All destructured elements are unused
]);

const auditorRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(auditorRoot, "tsconfig.collectors.json");

type Finding = {
  file: string;
  line: number;
  col: number;
  message: string;
};

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function loadProgram(): {
  program: ts.Program;
  host: ts.CompilerHost;
  config: ts.ParsedCommandLine;
} {
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    fail(
      `cannot read ${relative(process.cwd(), configPath)}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`,
    );
  }
  const config = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    auditorRoot,
    undefined,
    configPath,
  );
  if (config.errors.length) {
    fail(
      `invalid collectors tsconfig:\n${config.errors
        .map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n"))
        .join("\n")}`,
    );
  }
  const host = ts.createCompilerHost(config.options, true);
  const program = ts.createProgram({
    rootNames: config.fileNames,
    options: config.options,
    host,
  });
  return { program, host, config };
}

function isAssignEquals(node: ts.BinaryExpression): boolean {
  return node.operatorToken.kind === ts.SyntaxKind.EqualsToken;
}

/** True if `node` is an identifier write target for `name` (LHS of =). */
function isWriteTarget(node: ts.Node, name: string): boolean {
  if (!ts.isIdentifier(node) || node.text !== name) return false;
  const parent = node.parent;
  if (
    ts.isBinaryExpression(parent) &&
    isAssignEquals(parent) &&
    parent.left === node
  ) {
    return true;
  }
  return false;
}

/**
 * Classify how a statement uses `name` relative to an initializer:
 * - "read": initializer value may be observed on some path
 * - "write": every path through this statement overwrites without reading
 * - "none": no definitive use (no ref, or only conditional writes that leave
 *   the initializer live on another path — keep scanning)
 */
function statementUse(
  stmt: ts.Statement,
  name: string,
): "read" | "write" | "none" {
  const leafUse = (node: ts.Node): "read" | "write" | "none" => {
    let sawRead = false;
    let sawWrite = false;
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === name) {
        if (isWriteTarget(n, name)) sawWrite = true;
        else sawRead = true;
      }
      if (
        ts.isFunctionDeclaration(n) ||
        ts.isFunctionExpression(n) ||
        ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isConstructorDeclaration(n) ||
        ts.isClassDeclaration(n) ||
        ts.isClassExpression(n)
      ) {
        return;
      }
      // Nested control-flow is handled by the structured cases below when
      // `node` itself is a Statement; for expressions, walk normally.
      ts.forEachChild(n, visit);
    };
    visit(node);
    if (sawRead) return "read";
    if (sawWrite) return "write";
    return "none";
  };

  const blockUse = (blockStmt: ts.Statement): "read" | "write" | "none" => {
    const stmts = ts.isBlock(blockStmt)
      ? [...blockStmt.statements]
      : [blockStmt];
    for (const s of stmts) {
      const u = statementUse(s, name);
      if (u === "none") continue;
      return u;
    }
    return "none";
  };

  // if/else: only a definite write-kill when EVERY branch kills without reading.
  // Missing else ⇒ initializer remains live on the fall-through path.
  if (ts.isIfStatement(stmt)) {
    const thenU = blockUse(stmt.thenStatement);
    if (!stmt.elseStatement) {
      if (thenU === "read") return "read";
      return "none";
    }
    const elseU = blockUse(stmt.elseStatement);
    if (thenU === "read" || elseU === "read") return "read";
    if (thenU === "write" && elseU === "write") return "write";
    return "none";
  }

  // Loops may not run; conditional writes inside do not kill the initializer.
  if (
    ts.isForStatement(stmt) ||
    ts.isForInStatement(stmt) ||
    ts.isForOfStatement(stmt) ||
    ts.isWhileStatement(stmt) ||
    ts.isDoStatement(stmt)
  ) {
    const bodyU = blockUse(stmt.statement);
    if (bodyU === "read") return "read";
    // Also treat loop header reads (for (;; x)) as reads.
    if (
      ts.isForStatement(stmt) &&
      ((stmt.initializer && leafUse(stmt.initializer) === "read") ||
        (stmt.condition && leafUse(stmt.condition) === "read") ||
        (stmt.incrementor && leafUse(stmt.incrementor) === "read"))
    ) {
      return "read";
    }
    return "none";
  }

  if (ts.isTryStatement(stmt)) {
    const tryU = blockUse(stmt.tryBlock);
    const catchU = stmt.catchClause
      ? blockUse(stmt.catchClause.block)
      : "none";
    const finallyU = stmt.finallyBlock ? blockUse(stmt.finallyBlock) : "none";
    if (tryU === "read" || catchU === "read" || finallyU === "read") {
      return "read";
    }
    // Without a catch, try may throw before write; be conservative.
    if (!stmt.catchClause) {
      if (finallyU === "write") return "write";
      return "none";
    }
    if (tryU === "write" && catchU === "write") return "write";
    return "none";
  }

  if (ts.isSwitchStatement(stmt)) {
    // Conservative: any case read ⇒ read; only all-cases write is hard — skip.
    return leafUse(stmt) === "read" ? "read" : "none";
  }

  if (ts.isBlock(stmt)) return blockUse(stmt);

  if (
    ts.isExpressionStatement(stmt) &&
    ts.isBinaryExpression(stmt.expression) &&
    isAssignEquals(stmt.expression) &&
    ts.isIdentifier(stmt.expression.left) &&
    stmt.expression.left.text === name
  ) {
    // `x = <rhs>` — rhs may still read x.
    return leafUse(stmt.expression.right) === "read" ? "read" : "write";
  }

  return leafUse(stmt);
}

function isNullishInitializer(node: ts.Expression): boolean {
  return (
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.UndefinedKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined") ||
    (ts.isVoidExpression(node) &&
      node.expression.kind === ts.SyntaxKind.NumericLiteral)
  );
}

function checkBlock(
  statements: readonly ts.Statement[],
  sourceFile: ts.SourceFile,
  findings: Finding[],
): void {
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];

    if (
      ts.isVariableStatement(stmt) &&
      !(stmt.declarationList.flags & ts.NodeFlags.Const)
    ) {
      for (const decl of stmt.declarationList.declarations) {
        if (!decl.initializer) continue;
        // `= null` / `= undefined` is a common "unset" sentinel in collectors;
        // github-code-quality / CodeQL flagged non-nullish dead defaults
        // (e.g. statusHint = "not_demonstrated").
        if (isNullishInitializer(decl.initializer)) continue;
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        if (name.startsWith("_")) continue;

        for (let j = i + 1; j < statements.length; j++) {
          const use = statementUse(statements[j], name);
          if (use === "none") continue;
          if (use === "write") {
            const { line, character } = sourceFile.getLineAndCharacterOfPosition(
              decl.name.getStart(sourceFile),
            );
            findings.push({
              file: sourceFile.fileName,
              line: line + 1,
              col: character + 1,
              message: `useless assignment to local '${name}' — initial value is overwritten before it is read`,
            });
          }
          break;
        }
      }
    }

    // Recurse into nested statement blocks (if/else/for/while/try/…).
    const visitNested = (node: ts.Node): void => {
      if (ts.isBlock(node)) {
        checkBlock(node.statements, sourceFile, findings);
        return;
      }
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node)
      ) {
        // Nested functions: check their bodies separately via forEachChild below
        // by visiting their block children only through a dedicated walk.
        if (node.body && ts.isBlock(node.body)) {
          checkBlock(node.body.statements, sourceFile, findings);
        } else if (node.body) {
          ts.forEachChild(node.body, visitNested);
        }
        return;
      }
      ts.forEachChild(node, visitNested);
    };
    ts.forEachChild(stmt, visitNested);
  }
}

function findUselessAssignments(program: ts.Program): Finding[] {
  const findings: Finding[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (!sourceFile.fileName.includes("/collectors/")) continue;
    if (sourceFile.fileName.includes("node_modules")) continue;
    checkBlock(sourceFile.statements, sourceFile, findings);
  }
  return findings;
}

function main(): void {
  const { program } = loadProgram();
  const findings: Finding[] = [];

  const diagnostics = ts.getPreEmitDiagnostics(program);
  for (const d of diagnostics) {
    if (!d.file || d.code === undefined) continue;
    if (!UNUSED_DIAG_CODES.has(d.code)) continue;
    const start = d.start ?? 0;
    const { line, character } = d.file.getLineAndCharacterOfPosition(start);
    findings.push({
      file: d.file.fileName,
      line: line + 1,
      col: character + 1,
      message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    });
  }

  findings.push(...findUselessAssignments(program));

  // Stable order for CI logs
  findings.sort((a, b) =>
    a.file === b.file
      ? a.line - b.line || a.col - b.col
      : a.file.localeCompare(b.file),
  );

  if (findings.length === 0) {
    console.log(
      "aprf-auditor collectors unused check OK (noUnusedLocals/Params + useless assignments)",
    );
    return;
  }

  console.error(
    `FAIL: ${findings.length} unused-local / useless-assignment finding(s) in collectors:\n`,
  );
  for (const f of findings) {
    const rel = relative(process.cwd(), f.file);
    console.error(`  ${rel}:${f.line}:${f.col}  ${f.message}`);
  }
  console.error(
    "\nFix unused imports/locals, or remove dead initializers (declare without assigning until the real value is known).",
  );
  process.exit(1);
}

main();
