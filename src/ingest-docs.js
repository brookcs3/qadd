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
  console.log(`📝 Starting recursive chunking (target: ${targetChars} chars, overlap: ${overlap})`);
  
  // Recursive character splitter - tries separators in order of preference
  const separators = [
    '\n\n',    // Paragraph breaks (highest priority)
    '\n',      // Line breaks
    '. ',      // Sentence endings
    '! ',      // Exclamation sentences
    '? ',      // Question sentences
    '; ',      // Semicolons
    ', ',      // Commas
    ' ',       // Word boundaries
    ''         // Character level (last resort)
  ];

  function recursiveSplit(text, separators, targetSize, currentDepth = 0) {
    const indent = '  '.repeat(currentDepth);
    console.log(`${indent}🔍 Trying separator "${separators[0]}" on ${text.length} chars`);
    
    if (text.length <= targetSize) {
      console.log(`${indent}✅ Text fits in target size`);
      return [text];
    }

    if (separators.length === 0) {
      console.log(`${indent}⚠️ No separators left, force-splitting at ${targetSize} chars`);
      // Force split at character level
      const chunks = [];
      for (let i = 0; i < text.length; i += targetSize) {
        chunks.push(text.slice(i, i + targetSize));
      }
      return chunks;
    }

    const [currentSep, ...remainingSeps] = separators;
    
    if (currentSep === '') {
      // Character-level splitting
      console.log(`${indent}📏 Character-level splitting`);
      const chunks = [];
      for (let i = 0; i < text.length; i += targetSize) {
        chunks.push(text.slice(i, i + targetSize));
      }
      return chunks;
    }

    // Split by current separator
    const splits = text.split(currentSep);
    console.log(`${indent}📋 Split into ${splits.length} parts`);
    
    if (splits.length === 1) {
      // Separator not found, try next one
      console.log(`${indent}❌ Separator not found, trying next...`);
      return recursiveSplit(text, remainingSeps, targetSize, currentDepth + 1);
    }

    // Reconstruct chunks while respecting size limits
    const chunks = [];
    let currentChunk = '';

    for (let i = 0; i < splits.length; i++) {
      const piece = splits[i];
      const separator = (i < splits.length - 1) ? currentSep : '';
      const testChunk = currentChunk + (currentChunk ? currentSep : '') + piece;

      if (testChunk.length <= targetSize || currentChunk === '') {
        // Fits in current chunk or we need to start somewhere
        currentChunk = testChunk;
      } else {
        // Current chunk is full, save it and start new one
        if (currentChunk) {
          chunks.push(currentChunk);
        }
        currentChunk = piece;
      }

      // If this piece alone is too big, recursively split it
      if (piece.length > targetSize) {
        console.log(`${indent}🔄 Piece too big (${piece.length} chars), recursively splitting...`);
        if (currentChunk === piece) {
          // This piece started a new chunk, split it recursively
          chunks.pop(); // Remove the oversized chunk we just added
          const subChunks = recursiveSplit(piece, remainingSeps, targetSize, currentDepth + 1);
          chunks.push(...subChunks.slice(0, -1)); // Add all but last
          currentChunk = subChunks[subChunks.length - 1]; // Continue with last
        } else {
          // Save current chunk and recursively split the big piece
          if (currentChunk) chunks.push(currentChunk);
          const subChunks = recursiveSplit(piece, remainingSeps, targetSize, currentDepth + 1);
          chunks.push(...subChunks.slice(0, -1)); // Add all but last
          currentChunk = subChunks[subChunks.length - 1]; // Continue with last
        }
      }
    }

    // Add the final chunk if it has content
    if (currentChunk.trim()) {
      chunks.push(currentChunk);
    }

    console.log(`${indent}✅ Created ${chunks.length} chunks at this level`);
    return chunks;
  }

  // Apply the recursive splitter
  const rawChunks = recursiveSplit(text.trim(), separators, targetChars);
  
  // Add overlap and metadata
  const chunksWithOverlap = [];
  for (let i = 0; i < rawChunks.length; i++) {
    let content = rawChunks[i].trim();
    
    // Add overlap from previous chunk
    if (i > 0 && overlap > 0) {
      const prevContent = chunksWithOverlap[i - 1].content;
      const overlapText = prevContent.slice(-overlap);
      content = overlapText + ' ' + content;
    }
    
    chunksWithOverlap.push({
      content,
      payload: {
        section_title: null, // Could enhance this to detect headers
        section_index: null,
        chunk_index: i,
        char_count: content.length,
        original_index: i,
        has_overlap: i > 0 && overlap > 0
      }
    });
    
    console.log(`📦 Chunk ${i + 1}: ${content.length} chars${i > 0 && overlap > 0 ? ' (with overlap)' : ''}`);
  }

  console.log(`📊 Final result: ${chunksWithOverlap.length} chunks from ${text.length} characters`);
  console.log(`📈 Average chunk size: ${Math.round(chunksWithOverlap.reduce((sum, c) => sum + c.content.length, 0) / chunksWithOverlap.length)} chars`);
  
  return chunksWithOverlap;
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
