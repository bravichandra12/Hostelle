import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { ChromaClient } from "chromadb";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is missing");
}

const chroma = new ChromaClient({
  path: "http://localhost:8000",
});

const COLLECTION_NAME = "hostelle_docs";
const MAX_CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;

const createEmbedding = async (text) => {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: {
          parts: [{ text }],
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();
  return data.embedding.values;
};

const splitIntoChunks = (text) => {
  const cleanText = String(text || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleanText) {
    return [];
  }

  const chunks = [];
  let cursor = 0;

  while (cursor < cleanText.length) {
    const end = Math.min(
      cursor + MAX_CHUNK_SIZE,
      cleanText.length
    );

    const chunk = cleanText
      .slice(cursor, end)
      .trim();

    if (chunk) {
      chunks.push(chunk);
    }

    if (end === cleanText.length) {
      break;
    }

    cursor = Math.max(
      end - CHUNK_OVERLAP,
      cursor + 1
    );
  }

  return chunks;
};

export async function ingest() {
  const documentPath = path.join(
    __dirname,
    "../document/HostelleRules.txt"
  );

  const text = await fs.readFile(
    documentPath,
    "utf8"
  );

  const chunks = splitIntoChunks(text);

  try {
    await chroma.deleteCollection({
      name: COLLECTION_NAME,
    });
  } catch {}

  const collection =
    await chroma.getOrCreateCollection({
      name: COLLECTION_NAME,
      metadata: {
        "hnsw:space": "cosine",
      },
    });

  for (let i = 0; i < chunks.length; i++) {
    const embedding =
      await createEmbedding(chunks[i]);

    await collection.add({
      ids: [`chunk-${i}`],
      documents: [chunks[i]],
      embeddings: [embedding],
    });

    console.log(
      `Stored chunk ${i + 1}/${chunks.length}`
    );
  }

  console.log("Ingestion Complete");
}

ingest().catch(console.error);