import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { randomUUID } from 'crypto';

function preprocess(raw) {
  let t = raw.replace(/\r/g, '');
  t = t.replace(/(\w)-\n(\w)/g, '$1$2'); // de-hyphenate wrap
  t = t.replace(/\f/g, '\n\n');         // page breaks
  t = t.replace(/\n{3,}/g, '\n\n');     // collapse excess newlines
  t = t.replace(/[ \t]+\n/g, '\n');     // trim EOL spaces
  return t.trim();
}

function isHeading(p) {
  if (p.length > 90) return false;
  if (/^\d+(\.\d+)*(\s+|:|$)/.test(p)) return true;
  const letters = p.replace(/[^A-Za-z]/g, '');
  if (letters && letters === letters.toUpperCase()) return true;
  const words = p.split(/\s+/);
  const capRatio = words.filter(w => /^[A-Z][a-z]+/.test(w)).length / Math.max(words.length, 1);
  const punct = (p.match(/[.,:;!?]/g) || []).length;
  return capRatio > 0.6 && punct <= 1;
}

function buildChunks(text, targetChars = 1200, overlap = 200) {
  // Try double newlines first, fallback to single newlines, then sentences
  let paras = text.split(/\n{2,}/g).map(s => s.trim()).filter(Boolean);
  
  // If we only got 1 "paragraph", the text doesn't use double newlines
  if (paras.length === 1) {
    console.log('📝 No double newlines found, splitting on single newlines...');
    paras = text.split(/\n/g).map(s => s.trim()).filter(Boolean);
  }
  
  // If still too few breaks and the text is long, split on sentences
  if (paras.length < 3 && text.length > targetChars * 2) {
    console.log('📝 Few line breaks found, splitting on sentences...');
    paras = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  }

  console.log(`📝 Split into ${paras.length} segments`);
  
  let currentSection = null;
  let buf = '';
  let chunks = [];
  let sectionIndex = -1;
  let chunkIndex = 0;

  const flush = () => {
    const content = buf.trim();
    if (!content) return;
    chunks.push({
      content,
      payload: {
        section_title: currentSection || null,
        section_index: sectionIndex >= 0 ? sectionIndex : null,
        chunk_index: chunkIndex++,
        char_count: content.length
      }
    });
    console.log(`📦 Created chunk ${chunkIndex} (${content.length} chars)`);
    buf = '';
  };

  for (let p of paras) {
    if (isHeading(p)) {
      if (buf.trim()) flush();
      currentSection = p;
      sectionIndex++;
      continue;
    }

    const wouldBeLength = (buf + (buf ? ' ' : '') + p).length;
    if (wouldBeLength >= targetChars) {
      flush();
      if (chunks.length && overlap > 0) {
        const tail = chunks[chunks.length - 1].content;
        const overlapStr = tail.slice(-overlap);
        buf = overlapStr + ' ' + p;
      } else {
        buf = p;
      }
    } else {
      buf += (buf ? ' ' : '') + p;
    }
  }
  if (buf.trim()) flush();
  
  console.log(`📊 Total chunks created: ${chunks.length}`);
  return chunks;
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

async function upsertBatch(QDRANT_URL, COLLECTION_NAME, points) {
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
    VECTOR_SIZE,
    TARGET_CHARS = 1200,
    OVERLAP_CHARS = 200,
    BATCH_SIZE = 64
  } = cfg;

  const raw = fs.readFileSync(INPUT_PATH, 'utf-8');
  const pre = preprocess(raw);
  const chunks = buildChunks(pre, TARGET_CHARS, OVERLAP_CHARS);

  await ensureCollection(QDRANT_URL, COLLECTION_NAME, VECTOR_SIZE);

  const sourceFile = path.basename(INPUT_PATH);
  const pending = [];
  let done = 0;

  for (let i = 0; i < chunks.length; i++) {
    const { content, payload } = chunks[i];
    try {
      const embedding = await getEmbedding(EMBEDDING_MODEL, content);
      pending.push({
        id: randomUUID(),
        vector: embedding,
        payload: {
          ...payload,
          type: 'doc_chunk',
          file: sourceFile,
          text: content,
          processed_at: new Date().toISOString()
        }
      });
    } catch (e) {
      console.error(`Skip chunk ${i}: ${e.message}`);
    }

    const shouldFlush = pending.length >= BATCH_SIZE || i === chunks.length - 1;
    if (shouldFlush && pending.length) {
      const batch = pending.splice(0, pending.length);
      await upsertBatch(QDRANT_URL, COLLECTION_NAME, batch);
      done += batch.length;
      console.log(`upserted ${batch.length} (total ${done}/${chunks.length})`);
    }
  }

  console.log(`docs: upserted ${done}/${chunks.length} into ${COLLECTION_NAME}`);
}
