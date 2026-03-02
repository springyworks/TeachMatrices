// ═══════════════════════════════════════════════════════════════════════════════
//  TypeScript AST Parser — Extracts structural items from a TypeScript source
//  Uses the TypeScript compiler API (bundled in Monaco) to parse and analyze
//  the user's single source file into snippet blocks.
// ═══════════════════════════════════════════════════════════════════════════════

import type * as ts from 'typescript';

// We use Monaco's bundled TypeScript via the worker, but for AST parsing
// we load the TypeScript compiler that Monaco ships.
let tsModule: typeof ts | null = null;

/** Load the TypeScript compiler module (uses Monaco's bundled version) */
export async function loadTypeScript(): Promise<typeof ts> {
  if (tsModule) return tsModule;
  // Monaco bundles TypeScript — we can import it directly
  tsModule = await import('typescript');
  return tsModule;
}

// ─── Snippet Types ───────────────────────────────────────────────────────────

/** The kind of TypeScript construct a snippet represents */
export type SnippetKind =
  | 'class'
  | 'interface'
  | 'type-alias'
  | 'enum'
  | 'function'
  | 'variable'
  | 'import'
  | 'export'
  | 'namespace'
  | 'module-level'; // top-level statements not fitting other categories

/** A reference from one snippet to another (typed by TS semantics) */
export interface SnippetReference {
  /** The name being referenced */
  name: string;
  /** What kind of reference */
  kind: ReferenceKind;
}

export type ReferenceKind =
  | 'extends'       // class extends, interface extends
  | 'implements'    // class implements
  | 'type-ref'      // type references (in parameters, return types, generics)
  | 'calls'         // function/method calls
  | 'instantiates'  // new Foo()
  | 'imports'       // import references
  | 'uses-variable' // reads a variable from another snippet
  | 'uses-type';    // uses a type/interface from another snippet

/** A parsed structural snippet from the user's TypeScript source */
export interface TsSnippet {
  /** Unique identifier (based on position) */
  id: string;
  /** The name of the construct (class name, function name, variable name, etc.) */
  name: string;
  /** What kind of TS construct */
  kind: SnippetKind;
  /** The full source text of this snippet */
  code: string;
  /** Start line in the original source (0-based) */
  startLine: number;
  /** End line in the original source (0-based) */
  endLine: number;
  /** Start character offset in original source */
  startOffset: number;
  /** End character offset in original source */
  endOffset: number;
  /** Names this snippet exports / declares */
  declares: string[];
  /** References to other snippets */
  references: SnippetReference[];
  /** Is this an exported declaration? */
  exported: boolean;
  /** JSDoc or leading comments */
  leadingComment?: string;
}

/** Result of parsing a full TypeScript source file */
export interface ParseResult {
  snippets: TsSnippet[];
  /** Errors during parsing (if any) */
  diagnostics: string[];
  /** The original source text */
  sourceText: string;
}

// ─── Parser Implementation ───────────────────────────────────────────────────

let snippetCounter = 0;

function makeId(kind: SnippetKind, name: string): string {
  snippetCounter++;
  return `${kind}_${name}_${snippetCounter}`;
}

/** Reset the snippet counter (e.g., when re-parsing) */
export function resetParser(): void {
  snippetCounter = 0;
}

/**
 * Parse a TypeScript source string into structural snippets.
 * Each top-level declaration becomes a snippet.
 */
export function parseTypeScript(sourceText: string, tsCompiler: typeof ts): ParseResult {
  resetParser();
  const sourceFile = tsCompiler.createSourceFile(
    'user-source.ts',
    sourceText,
    tsCompiler.ScriptTarget.Latest,
    /* setParentNodes */ true,
    tsCompiler.ScriptKind.TS
  );

  const diagnostics: string[] = [];
  const snippets: TsSnippet[] = [];

  // Collect parsing errors
  // parseDiagnostics is internal but we can check via a program if needed
  // For now, just parse structurally

  for (const stmt of sourceFile.statements) {
    const snippet = extractSnippet(stmt, sourceFile, sourceText, tsCompiler);
    if (snippet) {
      snippets.push(snippet);
    }
  }

  // Resolve cross-references between snippets
  resolveReferences(snippets, sourceFile, tsCompiler);

  return { snippets, diagnostics, sourceText };
}

/** Extract a snippet from a top-level statement */
function extractSnippet(
  node: ts.Statement,
  sourceFile: ts.SourceFile,
  sourceText: string,
  tc: typeof ts
): TsSnippet | null {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  const code = sourceText.substring(node.getStart(sourceFile), node.getEnd());
  const exported = hasExportModifier(node, tc);
  const leadingComment = getLeadingComment(node, sourceFile, sourceText, tc);

  const fullCode = leadingComment ? leadingComment + '\n' + code : code;

  // Determine start/end including leading comments
  const actualStart = leadingComment
    ? sourceFile.getLineAndCharacterOfPosition(
        node.getFullStart()
      )
    : start;

  const base = {
    startLine: actualStart.line,
    endLine: end.line,
    startOffset: node.getFullStart(),
    endOffset: node.getEnd(),
    exported,
    leadingComment: leadingComment || undefined,
    references: [] as SnippetReference[],
  };

  // ── Class Declaration ──
  if (tc.isClassDeclaration(node)) {
    const name = node.name?.text ?? '<anonymous>';
    const declares = [name];
    // Collect method/property names
    for (const member of node.members) {
      if (tc.isMethodDeclaration(member) || tc.isPropertyDeclaration(member)) {
        const mName = member.name && tc.isIdentifier(member.name) ? member.name.text : null;
        if (mName) declares.push(`${name}.${mName}`);
      }
    }
    const refs: SnippetReference[] = [];
    // Heritage clauses
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types) {
        const typeName = type.expression.getText(sourceFile);
        refs.push({
          name: typeName,
          kind: clause.token === tc.SyntaxKind.ExtendsKeyword ? 'extends' : 'implements',
        });
      }
    }
    return {
      id: makeId('class', name),
      name,
      kind: 'class',
      code: fullCode,
      declares,
      ...base,
      references: refs,
    };
  }

  // ── Interface Declaration ──
  if (tc.isInterfaceDeclaration(node)) {
    const name = node.name.text;
    const refs: SnippetReference[] = [];
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types) {
        refs.push({ name: type.expression.getText(sourceFile), kind: 'extends' });
      }
    }
    return {
      id: makeId('interface', name),
      name,
      kind: 'interface',
      code: fullCode,
      declares: [name],
      ...base,
      references: refs,
    };
  }

  // ── Type Alias ──
  if (tc.isTypeAliasDeclaration(node)) {
    const name = node.name.text;
    return {
      id: makeId('type-alias', name),
      name,
      kind: 'type-alias',
      code: fullCode,
      declares: [name],
      ...base,
    };
  }

  // ── Enum Declaration ──
  if (tc.isEnumDeclaration(node)) {
    const name = node.name.text;
    const declares = [name];
    for (const member of node.members) {
      if (tc.isIdentifier(member.name)) {
        declares.push(`${name}.${member.name.text}`);
      }
    }
    return {
      id: makeId('enum', name),
      name,
      kind: 'enum',
      code: fullCode,
      declares,
      ...base,
    };
  }

  // ── Function Declaration ──
  if (tc.isFunctionDeclaration(node)) {
    const name = node.name?.text ?? '<anonymous>';
    return {
      id: makeId('function', name),
      name,
      kind: 'function',
      code: fullCode,
      declares: [name],
      ...base,
    };
  }

  // ── Variable Statement (const/let/var) ──
  if (tc.isVariableStatement(node)) {
    const declares: string[] = [];
    let name = '';
    for (const decl of node.declarationList.declarations) {
      if (tc.isIdentifier(decl.name)) {
        declares.push(decl.name.text);
        if (!name) name = decl.name.text;
      }
    }
    // Check if the value is a class expression, arrow function, etc. for better kind
    let kind: SnippetKind = 'variable';
    if (node.declarationList.declarations.length === 1) {
      const init = node.declarationList.declarations[0].initializer;
      if (init && (tc.isArrowFunction(init) || tc.isFunctionExpression(init))) {
        kind = 'function';
      } else if (init && tc.isClassExpression(init)) {
        kind = 'class';
      }
    }
    return {
      id: makeId(kind, name || 'var'),
      name: name || declares.join(', '),
      kind,
      code: fullCode,
      declares,
      ...base,
    };
  }

  // ── Import Declaration ──
  if (tc.isImportDeclaration(node)) {
    const moduleSpec = node.moduleSpecifier.getText(sourceFile).replace(/['"]/g, '');
    const declares: string[] = [];
    if (node.importClause) {
      if (node.importClause.name) {
        declares.push(node.importClause.name.text);
      }
      const bindings = node.importClause.namedBindings;
      if (bindings) {
        if (tc.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            declares.push(el.name.text);
          }
        } else if (tc.isNamespaceImport(bindings)) {
          declares.push(bindings.name.text);
        }
      }
    }
    return {
      id: makeId('import', moduleSpec),
      name: `import '${moduleSpec}'`,
      kind: 'import',
      code: fullCode,
      declares,
      ...base,
    };
  }

  // ── Export Declaration ──
  if (tc.isExportDeclaration(node) || tc.isExportAssignment(node)) {
    return {
      id: makeId('export', 'export'),
      name: 'export',
      kind: 'export',
      code: fullCode,
      declares: [],
      ...base,
    };
  }

  // ── Namespace / Module Declaration ──
  if (tc.isModuleDeclaration(node)) {
    const name = node.name.text;
    return {
      id: makeId('namespace', name),
      name,
      kind: 'namespace',
      code: fullCode,
      declares: [name],
      ...base,
    };
  }

  // ── Fallback: any other top-level statement ──
  return {
    id: makeId('module-level', 'stmt'),
    name: code.substring(0, 40).replace(/\n/g, ' ').trim() + (code.length > 40 ? '...' : ''),
    kind: 'module-level',
    code: fullCode,
    declares: [],
    ...base,
  };
}

/** Resolve references between snippets by walking each snippet's AST */
function resolveReferences(
  snippets: TsSnippet[],
  sourceFile: ts.SourceFile,
  tc: typeof ts
): void {
  // Build a set of all declared names → snippet id
  const declaredNames = new Map<string, string>();
  for (const s of snippets) {
    for (const d of s.declares) {
      const baseName = d.includes('.') ? d.split('.')[0] : d;
      declaredNames.set(baseName, s.id);
    }
  }

  // Walk each snippet's code to find identifier references
  for (const snippet of snippets) {
    // Parse the snippet to find identifiers
    const referencedNames = new Set<string>();
    const snippetSF = tc.createSourceFile(
      `snippet_${snippet.id}.ts`,
      snippet.code,
      tc.ScriptTarget.Latest,
      true,
      tc.ScriptKind.TS
    );

    walkForReferences(snippetSF, snippetSF, tc, referencedNames, snippet.declares);

    // Add references to other snippets
    for (const refName of referencedNames) {
      const targetId = declaredNames.get(refName);
      if (targetId && targetId !== snippet.id) {
        // Check if this reference already exists from heritage parsing
        const alreadyExists = snippet.references.some(
          (r) => r.name === refName
        );
        if (!alreadyExists) {
          // Determine reference kind
          const targetSnippet = snippets.find((s) => s.id === targetId);
          let kind: ReferenceKind = 'uses-variable';
          if (targetSnippet) {
            if (targetSnippet.kind === 'class') kind = 'instantiates';
            if (targetSnippet.kind === 'interface' || targetSnippet.kind === 'type-alias') kind = 'uses-type';
            if (targetSnippet.kind === 'function') kind = 'calls';
            if (targetSnippet.kind === 'enum') kind = 'uses-type';
          }
          snippet.references.push({ name: refName, kind });
        }
      }
    }
  }
}

/** Walk AST nodes to find identifier references */
function walkForReferences(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  tc: typeof ts,
  refs: Set<string>,
  ownDeclarations: string[]
): void {
  if (tc.isIdentifier(node)) {
    const name = node.text;
    // Skip if it's one of our own declarations (simple name, not dotted)
    if (!ownDeclarations.includes(name)) {
      refs.add(name);
    }
  }
  tc.forEachChild(node, (child) =>
    walkForReferences(child, sourceFile, tc, refs, ownDeclarations)
  );
}

/** Check if a statement has an export modifier */
function hasExportModifier(node: ts.Statement, tc: typeof ts): boolean {
  if ('modifiers' in node && Array.isArray((node as unknown as { modifiers: ts.ModifierLike[] }).modifiers)) {
    return (node as unknown as { modifiers: ts.ModifierLike[] }).modifiers.some(
      (m) => 'kind' in m && m.kind === tc.SyntaxKind.ExportKeyword
    );
  }
  return false;
}

/** Extract leading comment text for a node */
function getLeadingComment(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  sourceText: string,
  tc: typeof ts
): string | null {
  const fullStart = node.getFullStart();
  const start = node.getStart(sourceFile);
  if (fullStart === start) return null;

  const leadingText = sourceText.substring(fullStart, start).trim();
  if (!leadingText) return null;

  // Only return meaningful comments (not just whitespace)
  const commentRanges = tc.getLeadingCommentRanges(sourceText, fullStart);
  if (!commentRanges || commentRanges.length === 0) return null;

  return commentRanges
    .map((r) => sourceText.substring(r.pos, r.end))
    .join('\n');
}

// ─── Snippet Manipulation ────────────────────────────────────────────────────

/**
 * Reconstruct the full source file from snippets (in order).
 * Used when the user modifies a snippet in a Monaco block — the change
 * propagates back to the single source file.
 */
export function reconstructSource(snippets: TsSnippet[]): string {
  // Sort by original start position
  const sorted = [...snippets].sort((a, b) => a.startOffset - b.startOffset);
  return sorted.map((s) => s.code).join('\n\n');
}

/**
 * Given a snippet, find which item to extract (by name) and split it out.
 * Returns the modified original snippet + the newly extracted snippet.
 */
export function extractItem(
  snippet: TsSnippet,
  itemName: string,
  tsCompiler: typeof ts
): { modified: TsSnippet; extracted: TsSnippet } | null {
  // Parse the snippet
  const sf = tsCompiler.createSourceFile(
    'extract.ts',
    snippet.code,
    tsCompiler.ScriptTarget.Latest,
    true,
    tsCompiler.ScriptKind.TS
  );

  // For class snippets, allow extracting methods as standalone functions
  for (const stmt of sf.statements) {
    if (tsCompiler.isClassDeclaration(stmt) && stmt.name?.text === snippet.name) {
      for (const member of stmt.members) {
        if (
          tsCompiler.isMethodDeclaration(member) &&
          member.name &&
          tsCompiler.isIdentifier(member.name) &&
          member.name.text === itemName
        ) {
          // Extract the method as a standalone function
          const methodCode = snippet.code.substring(
            member.getStart(sf),
            member.getEnd()
          );
          // Remove the method from the class
          const modifiedCode =
            snippet.code.substring(0, member.getFullStart()) +
            snippet.code.substring(member.getEnd());

          const modifiedSnippet: TsSnippet = {
            ...snippet,
            code: modifiedCode,
            declares: snippet.declares.filter((d) => d !== `${snippet.name}.${itemName}`),
          };

          const extractedSnippet: TsSnippet = {
            id: makeId('function', itemName),
            name: itemName,
            kind: 'function',
            code: `// Extracted from ${snippet.name}\nfunction ${methodCode}`,
            startLine: 0,
            endLine: 0,
            startOffset: 0,
            endOffset: 0,
            declares: [itemName],
            references: [{ name: snippet.name, kind: 'uses-type' }],
            exported: false,
          };

          return { modified: modifiedSnippet, extracted: extractedSnippet };
        }
      }
    }
  }

  // For variable statements with multiple declarations, allow splitting
  for (const stmt of sf.statements) {
    if (tsCompiler.isVariableStatement(stmt)) {
      const decls = stmt.declarationList.declarations;
      const targetDecl = decls.find(
        (d) => tsCompiler.isIdentifier(d.name) && d.name.text === itemName
      );
      if (targetDecl && decls.length > 1) {
        const extractedCode = `const ${snippet.code.substring(
          targetDecl.getStart(sf),
          targetDecl.getEnd()
        )};`;
        const modifiedCode =
          snippet.code.substring(0, targetDecl.getFullStart()) +
          snippet.code.substring(
            targetDecl.getEnd() + (snippet.code[targetDecl.getEnd()] === ',' ? 1 : 0)
          );

        const modifiedSnippet: TsSnippet = {
          ...snippet,
          code: modifiedCode,
          declares: snippet.declares.filter((d) => d !== itemName),
        };

        const extractedSnippet: TsSnippet = {
          id: makeId('variable', itemName),
          name: itemName,
          kind: 'variable',
          code: extractedCode,
          startLine: 0,
          endLine: 0,
          startOffset: 0,
          endOffset: 0,
          declares: [itemName],
          references: [],
          exported: false,
        };

        return { modified: modifiedSnippet, extracted: extractedSnippet };
      }
    }
  }

  return null;
}
