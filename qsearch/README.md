📦 qsearch

A simple, powerful CLI tool for performing semantic (vector) searches on a Qdrant collection using Ollama embeddings.

---

🚀 Installation

	1.	Copy the qsearch script to a directory in your $PATH:
sudo cp qsearch /usr/local/bin/qsearch
	1.	Ensure it’s executable:
sudo chmod +x /usr/local/bin/qsearch

---

🔍 Usage

qsearch [--term <term> | --prompt <text>] [--limit <N>] [--collection <name>] [--model <model>]

Options:
	•	--term <term>  
  Embed a short keyword.  
  Example: --term "REHEARSE"

	•	--prompt <text>  
  Embed a full question or sentence.  
  Example: --prompt "Explain rehearse functionality"

	•	--limit <N>  
  Specify the number of results to return. (Default: 13)

	•	--collection <name>  
  Name of the Qdrant collection. *(Default: echoplex_manual_semantic)*

	•	--model <model>  
  Specify the Ollama embedding model. (Default: inke/Qwen3-Embedding-0.6B:latest)

	•	--help, -h  
  Display the help message.

---

🧪 Examples

	•	Search a single term with defaults:
qsearch --term "REHEARSE"

	•	Search with a full question:
qsearch --prompt "How do I start the unit half speed?"

	•	Search a full prompt and limit results to 5:
qsearch --prompt "What does the rehearse function do?" --limit 5

	•	Search using a different collection and model:
qsearch --prompt "test query" --collection my_other_collection --model "nomic-embed-text"

---
