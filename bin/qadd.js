#!/usr/bin/env node
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function help() {
  console.log(`
qadd <command> [options]

Commands:
  functions   Ingest JS functions/methods into Qdrant
  docs        Ingest text chunks (e.g., PDF->TXT) into Qdrant

General options (both commands):
  --file <path>            Input file (required)
  --qdrant <url>           Qdrant URL (default: http://localhost:6333)
  --collection <name>      Collection name (required; different per mode is OK)
  --model <name>           Ollama embedding model (default: inke/Qwen3-Embedding-0.6B:latest)
  --dim <int>              Vector size (default: 1024)

Docs-specific:
  --chunk <int>            Target chunk size (chars, default: 1200)
  --overlap <int>          Overlap (chars, default: 200)
  --batch <int>            Upsert batch size (default: 64)

Examples:
  qadd functions --file ./echoplex-pro.js --collection echoplex-pro-functions --dim 1024
  qadd docs --file ./manual.txt --collection echoplex-pro-docs --chunk 1200 --overlap 200
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      if (v && !v.startsWith('--')) { args[key] = v; i++; }
      else { args[key] = true; }
    }
  }
  return args;
}

async function main() {
  const [,, cmd, ...rest] = process.argv;
  if (!cmd || cmd === '--help' || cmd === '-h') return help();

  const args = parseArgs(rest);

  if (!args.file) {
    console.error('Missing --file');
    return process.exit(2);
  }
  if (!args.collection) {
    console.error('Missing --collection');
    return process.exit(2);
  }

  const common = {
    INPUT_PATH: path.resolve(args.file),
    QDRANT_URL: args.qdrant || 'http://localhost:6333',
    COLLECTION_NAME: args.collection,
    EMBEDDING_MODEL: args.model || 'inke/Qwen3-Embedding-0.6B:latest',
    VECTOR_SIZE: Number(args.dim || 1024)
  };

  if (cmd === 'functions') {
    const mod = await import(path.join(__dirname, '..', 'src', 'ingest-functions.js'));
    await mod.run(common);
  } else if (cmd === 'docs') {
    const mod = await import(path.join(__dirname, '..', 'src', 'ingest-docs.js'));
    await mod.run({
      ...common,
      TARGET_CHARS: Number(args.chunk || 1200),
      OVERLAP_CHARS: Number(args.overlap || 200),
      BATCH_SIZE: Number(args.batch || 64)
    });
  } else {
    console.error(`Unknown command: ${cmd}`);
    help();
    process.exit(2);
  }
}

main().catch(e => {
  console.error(e?.message || e);
  process.exit(1);
});
