import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';

/**
 * NOTE: This mirrors your extractor with minimal changes
 * (adds missing fs import; keeps class-context behavior).
 */
function extractFunctions(source) {
  const ast = parse(source, {
    sourceType: 'module',
    plugins: ['classProperties', 'jsx']
  });

  const functions = [];
  let currentClass = '';

  // First pass: collect class names (as in your version)
  traverse(ast, {
    ClassDeclaration(p) {
      currentClass = p.node.id.name;
    },
    ClassExpression(p) {
      currentClass = p.node.id?.name || '(anonymous class)';
    }
  });

  // Second pass: collect functions with class context
  traverse(ast, {
    FunctionDeclaration(p) {
      functions.push({
        name: p.node.id?.name || '(anonymous)',
        type: 'function',
        class: currentClass || null,
        loc: p.node.loc,
        code: source.slice(p.node.start, p.node.end)
      });
    },
    ClassMethod(p) {
      functions.push({
        name: p.node.key.name,
        type: 'method',
        class: currentClass || null,
        isStatic: p.node.static,
        loc: p.node.loc,
        code: source.slice(p.node.start, p.node.end)
      });
    },
    ArrowFunctionExpression(p) {
      if (p.parent.type === 'VariableDeclarator') {
        functions.push({
          name: p.parent.id.name,
          type: 'arrow_function',
          class: currentClass || null,
          loc: p.node.loc,
          code: source.slice(p.node.start, p.node.end)
        });
      }
    }
  });

  return functions;
}

async function getEmbedding(model, text) {
  const res = await fetch('http://localhost:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt: text })
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.embedding;
}

async function ensureCollection(QDRANT_URL, COLLECTION_NAME, VECTOR_SIZE) {
  const probe = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
  if (probe.status === 200) return;

  const create = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vectors: { size: VECTOR_SIZE, distance: 'Cosine' } })
  });
  if (!create.ok) throw new Error(await create.text());
}

async function upsert(QDRANT_URL, COLLECTION_NAME, points) {
  const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points?wait=true`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points })
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function run(cfg) {
  const {
    INPUT_PATH,
    QDRANT_URL,
    COLLECTION_NAME,
    EMBEDDING_MODEL,
    VECTOR_SIZE
  } = cfg;

  const source = fs.readFileSync(INPUT_PATH, 'utf-8');
  const functions = extractFunctions(source);

  await ensureCollection(QDRANT_URL, COLLECTION_NAME, VECTOR_SIZE);

  let count = 0;
  for (const func of functions) {
    try {
      const embedding = await getEmbedding(EMBEDDING_MODEL, func.code);
      const point = {
        id: randomUUID(),
        vector: embedding,
        payload: {
          name: func.name,
          type: func.type,
          class: func.class,
          file: path.basename(INPUT_PATH),
          start_line: func.loc?.start?.line,
          end_line: func.loc?.end?.line,
          start_column: func.loc?.start?.column,
          end_column: func.loc?.end?.column,
          is_static: func.isStatic || false,
          code_snippet: func.code?.substring(0, 1000) + '...',
          processed_at: new Date().toISOString()
        }
      };
      await upsert(QDRANT_URL, COLLECTION_NAME, [point]);
      count++;
    } catch (e) {
      console.error(`Skip ${func.name}: ${e.message}`);
    }
  }
  console.log(`functions: upserted ${count}/${functions.length} into ${COLLECTION_NAME}`);
}
