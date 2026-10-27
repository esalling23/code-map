import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import type { CallEdge, CodeMap, CodeSymbol, DataEdge, DataRelation, ImportEdge, RepoRoot, SymbolKind } from "./types";

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".turbo", ".cache"]);

export interface AnalyzeOptions {
  /** Sub-paths (relative to each root) to restrict analysis to. Roots without a given sub-path skip it. */
  include?: string[];
  /** Skip test files (`*.test.*`, `*.spec.*`, `__tests__/`). Defaults to true. */
  skipTests?: boolean;
}

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

export function findSourceFiles(dir: string, skipTests = true): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (skipTests && name === "__tests__") continue;
        walk(full);
      } else if (SOURCE_EXT.test(name) && !name.endsWith(".d.ts")) {
        if (skipTests && /\.(test|spec)\.[^.]+$/.test(name)) continue;
        out.push(full);
      }
    }
  };
  if (statSync(dir).isFile()) return [dir];
  walk(dir);
  return out.sort();
}

/** Every `package.json` under `dir` (outside node_modules), as package name → package directory. */
function findPackages(dir: string, into: Map<string, string>) {
  const walk = (d: string) => {
    const pkg = join(d, "package.json");
    if (existsSync(pkg)) {
      try {
        const name = JSON.parse(readFileSync(pkg, "utf8")).name;
        if (typeof name === "string" && !into.has(name)) into.set(name, real(d));
      } catch {
        /* unreadable package.json */
      }
    }
    for (const name of readdirSync(d)) {
      if (SKIP_DIRS.has(name) || name.startsWith(".")) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
    }
  };
  walk(dir);
}

function labelRoots(dirs: string[]): RepoRoot[] {
  if (dirs.length === 1) return [{ label: "", dir: dirs[0] }];
  const labels = dirs.map((d) => basename(d));
  return dirs.map((dir, i) => {
    const clash = labels.filter((l) => l === labels[i]).length > 1;
    return { label: clash ? `${basename(dirname(dir))}-${labels[i]}` : labels[i], dir };
  });
}

export function analyze(rootDirs: string | string[], opts: AnalyzeOptions = {}): CodeMap {
  const roots = labelRoots((Array.isArray(rootDirs) ? rootDirs : [rootDirs]).map((d) => real(resolve(d))));
  const skipTests = opts.skipTests ?? true;
  const fileNames = roots.flatMap((r) =>
    (opts.include?.length ? opts.include : ["."])
      .map((p) => resolve(r.dir, p))
      .filter((p) => existsSync(p))
      .flatMap((p) => findSourceFiles(p, skipTests)),
  );
  if (!fileNames.length) throw new Error("No source files found in the given directories.");

  const packages = new Map<string, string>();
  for (const r of roots) findPackages(r.dir, packages);

  const program = ts.createProgram(fileNames, {
    allowJs: true,
    checkJs: false,
    jsx: ts.JsxEmit.Preserve,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const rootsByDepth = [...roots].sort((a, b) => b.dir.length - a.dir.length);
  const repoOf = (abs: string) => rootsByDepth.find((r) => abs === r.dir || abs.startsWith(r.dir + sep))!;
  const rel = (f: string) => {
    const abs = real(f);
    const root = repoOf(abs);
    const path = relative(root.dir, abs).split(sep).join("/");
    return root.label ? (path ? `${root.label}/${path}` : root.label) : path;
  };
  const ownFiles = new Set(fileNames.map(real));
  const sourceFiles = program.getSourceFiles().filter((sf) => !sf.fileName.includes("/node_modules/") && ownFiles.has(real(sf.fileName)));

  const symbols: Record<string, CodeSymbol> = {};
  const fileDocs: Record<string, string> = {};
  const declToId = new Map<ts.Node, string>();
  /** Node whose subtree belongs to a symbol (function body, arrow initializer, ...). */
  const ownerNodes = new Map<ts.Node, string>();
  const classCtor = new Map<string, string>();

  const lineOf = (sf: ts.SourceFile, pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  function docFor(sf: ts.SourceFile, node: ts.Node): string {
    const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? [];
    const last = ranges[ranges.length - 1];
    return last ? cleanComment(sf.text.slice(last.pos, last.end)) : "";
  }

  /** The first comment in a file, when it sits above the first statement and isn't that statement's own doc. */
  function docAt(sf: ts.SourceFile, pos: number): string {
    const ranges = (ts.getLeadingCommentRanges(sf.text, pos) ?? []).filter((r) => !sf.text.slice(r.pos, r.end).startsWith("#!"));
    const first = sf.statements[0];
    if (!ranges.length || !first) return "";
    const own = ranges.length === 1 && !/^(import|export \*|export \{)/.test(first.getText(sf)) && sf.text.slice(ranges[0].end, first.getStart(sf)).trim() === "";
    return own ? "" : cleanComment(sf.text.slice(ranges[0].pos, ranges[0].end));
  }

  function cleanComment(raw: string): string {
    return raw
      .replace(/^\/\*\*?|\*\/$/g, "")
      .split("\n")
      .map((l) => l.replace(/^\s*(\*|\/\/)\s?/, "").trim())
      .filter((l) => l && !l.startsWith("@"))
      .join(" ")
      .trim();
  }

  function signatureFor(sf: ts.SourceFile, node: ts.Node, body?: ts.Node): string {
    const end = body ? body.getStart(sf) : node.getEnd();
    const text = sf.text.slice(node.getStart(sf), end).replace(/\s+/g, " ").replace(/\s*=>\s*$/, " =>").trim();
    return text.length > 220 ? `${text.slice(0, 217)}...` : text;
  }

  function isExported(node: ts.Node): boolean {
    const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  }

  function add(
    sf: ts.SourceFile,
    name: string,
    kind: SymbolKind,
    node: ts.Node,
    opts: { docNode?: ts.Node; codeNode?: ts.Node; body?: ts.Node; exported?: boolean; owner?: ts.Node },
  ): string {
    const file = rel(sf.fileName);
    let id = `${file}#${name}`;
    for (let i = 2; symbols[id]; i++) id = `${file}#${name}~${i}`;
    const codeNode = opts.codeNode ?? node;
    symbols[id] = {
      id,
      name,
      kind,
      file,
      repo: repoOf(real(sf.fileName)).label,
      startLine: lineOf(sf, codeNode.getStart(sf)),
      endLine: lineOf(sf, codeNode.getEnd()),
      signature: signatureFor(sf, node, opts.body),
      doc: docFor(sf, opts.docNode ?? node),
      code: sf.text.slice(codeNode.getStart(sf), codeNode.getEnd()),
      exported: opts.exported ?? isExported(opts.docNode ?? node),
      externalCalls: [],
    };
    declToId.set(node, id);
    if (opts.owner) ownerNodes.set(opts.owner, id);
    return id;
  }

  const isFnLike = (n: ts.Node | undefined): n is ts.ArrowFunction | ts.FunctionExpression =>
    !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

  function indexClass(sf: ts.SourceFile, cls: ts.ClassLikeDeclaration, className: string, exported: boolean, docNode: ts.Node) {
    const classId = add(sf, className, "class", cls, { exported, docNode });
    const header = sf.text.slice(cls.getStart(sf), cls.members.pos).replace(/\s+/g, " ");
    symbols[classId].signature = header.replace(/\{\s*$/, "").trim();
    for (const m of cls.members) {
      const memberName = m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name) || ts.isStringLiteral(m.name)) ? m.name.text : undefined;
      if (ts.isConstructorDeclaration(m) && m.body) {
        classCtor.set(classId, add(sf, `${className}.constructor`, "method", m, { body: m.body, exported, owner: m }));
      } else if ((ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) && m.body && memberName) {
        const prefix = ts.isGetAccessorDeclaration(m) ? "get " : ts.isSetAccessorDeclaration(m) ? "set " : "";
        add(sf, `${className}.${prefix}${memberName}`, "method", m, { body: m.body, exported, owner: m });
      } else if (ts.isPropertyDeclaration(m) && isFnLike(m.initializer) && memberName) {
        add(sf, `${className}.${memberName}`, "method", m, { body: m.initializer.body, exported, owner: m.initializer });
      }
    }
  }

  // Pass 1: index declarations.
  for (const sf of sourceFiles) {
    const file = rel(sf.fileName);
    const moduleId = `${file}#<module>`;
    symbols[moduleId] = {
      id: moduleId,
      name: "<module>",
      kind: "module",
      file,
      repo: repoOf(real(sf.fileName)).label,
      startLine: 1,
      endLine: lineOf(sf, sf.getEnd()),
      signature: file,
      doc: docFor(sf, sf.statements[0] ?? sf),
      code: sf.text,
      exported: false,
      externalCalls: [],
    };
    ownerNodes.set(sf, moduleId);
    const header = docAt(sf, 0);
    if (header) fileDocs[file] = header;

    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.body) {
        const name = st.name?.text ?? "default";
        add(sf, name, "function", st, { body: st.body, owner: st });
      } else if (ts.isClassDeclaration(st)) {
        indexClass(sf, st, st.name?.text ?? "default", isExported(st), st);
      } else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) {
        add(sf, st.name.text, "data", st, {});
      } else if (ts.isVariableStatement(st)) {
        const exported = isExported(st);
        for (const decl of st.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
          const init = decl.initializer;
          if (isFnLike(init)) {
            add(sf, decl.name.text, "function", decl, { docNode: st, codeNode: st, body: init.body, exported, owner: init });
          } else if (ts.isClassExpression(init)) {
            indexClass(sf, init, decl.name.text, exported, st);
            declToId.set(decl, declToId.get(init)!);
          } else if (ts.isObjectLiteralExpression(init)) {
            // `export const service = { run() {...}, stop: () => {...} }`
            for (const p of init.properties) {
              if (!p.name || !ts.isIdentifier(p.name)) continue;
              if (ts.isMethodDeclaration(p) && p.body) {
                add(sf, `${decl.name.text}.${p.name.text}`, "method", p, { body: p.body, exported, owner: p });
              } else if (ts.isPropertyAssignment(p) && isFnLike(p.initializer)) {
                add(sf, `${decl.name.text}.${p.name.text}`, "method", p, { body: p.initializer.body, exported, owner: p.initializer });
              }
            }
          }
        }
      } else if (ts.isExportAssignment(st) && isFnLike(st.expression)) {
        add(sf, "default", "function", st, { body: st.expression.body, exported: true, owner: st.expression });
      }
    }
  }

  const byName = new Map<string, string[]>();
  for (const s of Object.values(symbols)) (byName.get(s.name) ?? byName.set(s.name, []).get(s.name)!).push(s.id);

  const packageNameCache = new Map<string, string | undefined>();
  function packageNameOf(file: string): string | undefined {
    const dir = dirname(file);
    if (packageNameCache.has(dir)) return packageNameCache.get(dir);
    let name: string | undefined;
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        name = JSON.parse(readFileSync(pkg, "utf8")).name;
      } catch {
        /* unreadable package.json */
      }
    } else if (dirname(dir) !== dir) {
      name = packageNameOf(dir);
    }
    packageNameCache.set(dir, name);
    return name;
  }

  function qualifiedName(decl: ts.Declaration): string | undefined {
    const own = ts.getNameOfDeclaration(decl);
    if (ts.isConstructorDeclaration(decl)) {
      const cls = decl.parent as ts.ClassLikeDeclaration;
      return cls.name ? `${cls.name.text}.constructor` : undefined;
    }
    if (!own || !(ts.isIdentifier(own) || ts.isPrivateIdentifier(own))) return undefined;
    const parent = decl.parent;
    if ((ts.isClassLike(parent) || ts.isInterfaceDeclaration(parent)) && parent.name) return `${parent.name.text}.${own.text}`;
    return own.text;
  }

  /**
   * Links a declaration outside the analyzed sources (typically a package's built `.d.ts`)
   * to the source symbol of the same name in that package, when the package is one of ours.
   */
  function linkByPackage(decl: ts.Declaration, preferCtor: boolean): string | undefined {
    // Only built type declarations stand in for source; a local helper inside an analyzed file is not indexed and must stay unlinked.
    if (!decl.getSourceFile().isDeclarationFile) return undefined;
    const pkgDir = packages.get(packageNameOf(real(decl.getSourceFile().fileName)) ?? "");
    if (!pkgDir) return undefined;
    const name = qualifiedName(decl);
    if (!name) return undefined;
    const prefix = rel(pkgDir);
    const inPkg = (byName.get(name) ?? []).filter((id) => !prefix || symbols[id].file.startsWith(`${prefix}/`));
    const id = inPkg.find((i) => symbols[i].exported) ?? inPkg[0];
    if (id && preferCtor && symbols[id].kind === "class") return classCtor.get(id) ?? id;
    return id;
  }

  function resolveSymbol(node: ts.Node): ts.Symbol | undefined {
    let sym = checker.getSymbolAtLocation(node);
    if (sym && sym.flags & ts.SymbolFlags.Alias) {
      try {
        sym = checker.getAliasedSymbol(sym);
      } catch {
        /* unresolvable alias */
      }
    }
    return sym;
  }

  function idForSymbol(sym: ts.Symbol | undefined, preferCtor: boolean): { id: string; inferred?: boolean } | undefined {
    for (const decl of sym?.declarations ?? []) {
      const id = declToId.get(decl);
      if (!id) continue;
      if (preferCtor && symbols[id].kind === "class") return { id: classCtor.get(id) ?? id };
      return { id };
    }
    for (const decl of sym?.declarations ?? []) {
      const id = linkByPackage(decl, preferCtor);
      if (id) return { id, inferred: true };
    }
    return undefined;
  }

  const calls: CallEdge[] = [];
  const dataSeen = new Set<string>();
  const data: DataEdge[] = [];
  const importSeen = new Set<string>();
  const imports: ImportEdge[] = [];

  const addData = (from: string, to: string, relation: DataRelation) => {
    if (from === to) return;
    const key = `${from}|${to}|${relation}`;
    if (dataSeen.has(key)) return;
    dataSeen.add(key);
    data.push({ from, to, relation });
  };

  // Pass 2: walk bodies for calls, data references and imports.
  for (const sf of sourceFiles) {
    const file = rel(sf.fileName);
    let order = 0;

    const visit = (node: ts.Node, owner: string, inParam: boolean, inReturn: boolean) => {
      const nextOwner = ownerNodes.get(node) ?? owner;

      if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier)) {
        const spec = node.moduleSpecifier;
        const target = spec && resolveSymbol(spec)?.declarations?.[0]?.getSourceFile();
        if (target && ownFiles.has(real(target.fileName))) {
          const to = rel(target.fileName);
          const key = `${file}|${to}`;
          if (to !== file && !importSeen.has(key)) {
            importSeen.add(key);
            imports.push({ from: file, to });
          }
        }
      }

      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const expr = node.expression;
        const target = ts.isPropertyAccessExpression(expr) ? expr.name : ts.isElementAccessExpression(expr) ? expr.argumentExpression : expr;
        const isNew = ts.isNewExpression(node);
        const resolved = idForSymbol(resolveSymbol(target), isNew);
        const line = lineOf(sf, node.getStart(sf));
        if (resolved && resolved.id !== nextOwner) {
          const to = resolved.id;
          calls.push({ from: nextOwner, to, line, order: order++, ...(resolved.inferred ? { inferred: true } : {}) });
          if (isNew) {
            const cls = symbols[to].kind === "class" ? to : to.replace(/\.constructor$/, "");
            if (symbols[cls]) addData(nextOwner, cls, "creates");
          }
        } else if (!resolved && expr.kind !== ts.SyntaxKind.SuperKeyword && expr.kind !== ts.SyntaxKind.ImportKeyword) {
          const text = (isNew ? "new " : "") + expr.getText(sf).replace(/\s+/g, "");
          symbols[nextOwner].externalCalls.push({ text: text.length > 60 ? `${text.slice(0, 57)}...` : text, line });
        }
      }

      if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
        const nameNode = ts.isTypeReferenceNode(node) ? node.typeName : node.expression;
        const leaf = ts.isQualifiedName(nameNode) ? nameNode.right : ts.isPropertyAccessExpression(nameNode) ? nameNode.name : nameNode;
        const to = idForSymbol(resolveSymbol(leaf), false)?.id;
        if (to && (symbols[to].kind === "data" || symbols[to].kind === "class")) {
          addData(nextOwner, to, inReturn ? "returns" : inParam ? "param" : "uses");
        }
      }

      const fnLike = ts.isFunctionLike(node) && ownerNodes.has(node) ? node : isFnLike(node) && ownerNodes.has(node) ? node : undefined;
      ts.forEachChild(node, (child) => {
        let p = inParam;
        let r = inReturn;
        if (fnLike) {
          p = ts.isParameter(child);
          r = (fnLike as ts.SignatureDeclaration).type === child;
        } else if (ts.isBlock(child)) {
          p = false;
          r = false;
        }
        visit(child, nextOwner, p, r);
      });
    };

    visit(sf, `${file}#<module>`, false, false);
  }

  // Drop module pseudo-symbols that do nothing beyond declarations.
  for (const id of Object.keys(symbols)) {
    const s = symbols[id];
    if (s.kind !== "module") continue;
    const active = calls.some((c) => c.from === id) || s.externalCalls.length > 0;
    if (!active) delete symbols[id];
  }

  return {
    roots,
    files: sourceFiles.map((sf) => rel(sf.fileName)),
    fileDocs,
    symbols,
    calls,
    data: data.filter((d) => symbols[d.from] && symbols[d.to]),
    imports,
  };
}
