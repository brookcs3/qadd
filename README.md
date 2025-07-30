# qadd

Add code functions and document chunks to Qdrant using Ollama embeddings.

## Install (local)

```bash
git clone <this-repo>
cd qadd
npm install
npm link     # installs `qadd` into your PATH
```

## Usage

```bash
# Functions (JS)
qadd functions --file ./echoplex-pro.js \
  --collection echoplex-pro-functions \
  --model inke/Qwen3-Embedding-0.6B:latest \
  --dim 1024

# Docs (TXT from PDF)
qadd docs --file ./manual.txt \
  --collection echoplex-pro-docs \
  --model inke/Qwen3-Embedding-0.6B:latest \
  --dim 1024 --chunk 1200 --overlap 200 --batch 64
```

## Requirements
- Node.js 18+
- Qdrant running at http://localhost:6333
- Ollama running at http://localhost:11434 with your embedding model available

## Options

### General (both commands)
- `--file <path>`: Input file (required)
- `--qdrant <url>`: Qdrant URL (default: http://localhost:6333)
- `--collection <name>`: Collection name (required)
- `--model <name>`: Ollama embedding model (default: inke/Qwen3-Embedding-0.6B:latest)
- `--dim <int>`: Vector size (default: 1024)

### Docs-specific
- `--chunk <int>`: Target chunk size in characters (default: 1200)
- `--overlap <int>`: Overlap in characters (default: 200)
- `--batch <int>`: Upsert batch size (default: 64)
