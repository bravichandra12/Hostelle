import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VECTOR_DB_PATH = path.resolve(__dirname, "../data/data/vector_store/chroma.sqlite3");
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const MAX_CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 120;

let chunkCache = null;
let cacheLoadedAt = null;

const normalizeText = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value) => normalizeText(value).split(" ").filter(Boolean);

const termFrequency = (tokens) => {
  const freq = new Map();
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }
  return freq;
};

const cosineSimilarity = (query, documentText) => {
  const queryTokens = tokenize(query);
  const docTokens = tokenize(documentText);

  if (!queryTokens.length || !docTokens.length) {
    return 0;
  }

  const queryVector = termFrequency(queryTokens);
  const docVector = termFrequency(docTokens);

  let dotProduct = 0;
  let queryNorm = 0;
  let docNorm = 0;

  queryVector.forEach((value, key) => {
    queryNorm += value * value;
    dotProduct += value * (docVector.get(key) || 0);
  });

  docVector.forEach((value) => {
    docNorm += value * value;
  });

  const denominator = Math.sqrt(queryNorm) * Math.sqrt(docNorm);
  return denominator ? dotProduct / denominator : 0;
};

const splitIntoChunks = (text) => {
  const cleanText = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleanText) {
    return [];
  }

  const chunks = [];
  let cursor = 0;

  while (cursor < cleanText.length) {
    const end = Math.min(cursor + MAX_CHUNK_SIZE, cleanText.length);
    const chunk = cleanText.slice(cursor, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end === cleanText.length) {
      break;
    }
    cursor = Math.max(end - CHUNK_OVERLAP, cursor + 1);
  }

  return chunks;
};

const getPythonCandidates = () => {
  const workspaceVenv = path.resolve(__dirname, "../../.venv/Scripts/python.exe");

  return [
    process.env.PYTHON_EXECUTABLE,
    workspaceVenv,
    "python",
    "py",
  ].filter(Boolean);
};

const loadChromaMetadataWithPython = async () => {
  const script = `import sqlite3, json
con = sqlite3.connect(r"${VECTOR_DB_PATH.replace(/\\/g, "\\\\")}")
cur = con.cursor()
rows = cur.execute("""
SELECT em.id,
       MAX(CASE WHEN em.key='chroma:document' THEN em.string_value END) AS document,
       MAX(CASE WHEN em.key='source' THEN em.string_value END) AS source
FROM embedding_metadata em
GROUP BY em.id
HAVING document IS NOT NULL
""").fetchall()
print(json.dumps([{"document": r[1], "source": r[2]} for r in rows]))`;

  let lastError = null;
  for (const candidate of getPythonCandidates()) {
    try {
      const args = candidate === "py" ? ["-3", "-c", script] : ["-c", script];
      const { stdout } = await execFileAsync(candidate, args, { timeout: 20000 });
      const parsed = JSON.parse(stdout || "[]");
      return parsed;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Unable to read Chroma metadata via Python: ${lastError?.message || "unknown error"}`);
};

const loadPdfChunks = async () => {
  if (chunkCache) {
    return chunkCache;
  }

  const metadataRows = await loadChromaMetadataWithPython();
  const allChunks = [];
  metadataRows.forEach((row, index) => {
    const sourceName = String(row.source || "vector_store").split(/[\\/]/).pop() || "vector_store";
    const chunks = splitIntoChunks(row.document || "");
    chunks.forEach((chunkText, chunkIndex) => {
      allChunks.push({
        id: `${sourceName}-${index}-${chunkIndex}`,
        source: sourceName,
        text: chunkText,
      });
    });
  });

  if (!allChunks.length) {
    throw new Error("No documents found in Chroma metadata");
  }

  chunkCache = allChunks;
  cacheLoadedAt = new Date().toISOString();
  return chunkCache;
};

const retrieveTopChunks = async (query, topK = 4) => {
  const chunks = await loadPdfChunks();
  const scored = chunks
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(query, chunk.text),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored;
};

const buildPrompt = (question, contextBlocks, history = []) => {
  const recentHistory = history.slice(-6);
  const historyBlock = recentHistory.length
    ? recentHistory
      .map((entry) => `${entry.role === "user" ? "User" : "Assistant"}: ${entry.content}`)
      .join("\n")
    : "No previous conversation.";

  const context = contextBlocks
    .map((chunk, index) => `Source ${index + 1} (${chunk.source}):\n${chunk.text}`)
    .join("\n\n");

  return `You are a hostel information assistant for the HackByte app.
Answer only using the provided context. If the context is missing relevant facts, clearly say you do not have enough information.
Return only the direct answer in one short sentence.
Do not include reasoning, source names, or extra preface text.

Conversation history:
${historyBlock}

Context:
${context || "No retrieved context."}

User question: ${question}`;
};

const callGemini = async (prompt) => {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 350,
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini request failed: ${response.status} ${errorBody}`);
  }

  const payload = await response.json();
  const text =
    payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n")
      .trim() || "";

  return text || null;
};

const buildFallbackAnswer = (question, chunks) => {
  if (!chunks.length) {
    return "I do not have enough information to answer that.";
  }

  const mergedText = chunks.map((chunk) => String(chunk.text || "")).join(" ");
  const lowerQuestion = String(question || "").toLowerCase();

  const pick = (regex, format) => {
    const match = mergedText.match(regex);
    if (!match) return null;
    const value = (match[1] || "").trim();
    if (!value) return null;
    return typeof format === "function" ? format(value) : value;
  };

  const questionTokens = new Set(tokenize(question));
  const candidateSentences = chunks
    .flatMap((chunk) => String(chunk.text || "").split(/(?<=[.!?])\s+/))
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (!candidateSentences.length) {
    return "I do not have enough information to answer that.";
  }

  const scoreSentence = (sentence) => {
    const sentenceTokens = tokenize(sentence);
    if (!sentenceTokens.length) return 0;
    let overlap = 0;
    for (const token of sentenceTokens) {
      if (questionTokens.has(token)) overlap += 1;
    }
    return overlap / sentenceTokens.length;
  };

  const bestSentence = candidateSentences
    .map((sentence) => ({ sentence, score: scoreSentence(sentence) }))
    .sort((a, b) => b.score - a.score)[0]?.sentence;

  return bestSentence || "I do not have enough information to answer that.";
};

router.post("/query", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const topChunks = await retrieveTopChunks(message, 4);
    const prompt = buildPrompt(message, topChunks, history);

    let answer = null;
    try {
      answer = await callGemini(prompt);
    } catch (geminiError) {
      console.error("Gemini call failed, using fallback answer:", geminiError.message);
    }

    if (!answer) {
      answer = buildFallbackAnswer(message, topChunks);
    }

    return res.json({
      success: true,
      answer,
      sources: topChunks.map((chunk) => ({
        source: chunk.source,
        score: Number(chunk.score.toFixed(3)),
      })),
      cacheLoadedAt,
    });
  } catch (error) {
    console.error("Chatbot query error", error);
    return res.status(500).json({ error: "Unable to generate chatbot response" });
  }
});

export default router;