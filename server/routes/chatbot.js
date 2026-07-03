import express from "express";
import { ChromaClient } from "chromadb";

const router = express.Router();

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-2.0-flash";

const COLLECTION_NAME = "hostelle_docs";

const chroma = new ChromaClient({
  path: "http://localhost:8000",
});

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

const retrieveTopChunks = async (
  query,
  topK = 4
) => {
  const embedding =
    await createEmbedding(query);

  const collection =
    await chroma.getCollection({
      name: COLLECTION_NAME,
    });

  const results =
    await collection.query({
      queryEmbeddings: [embedding],
      nResults: topK,
    });

  return (
    results.documents?.[0]?.map(
      (text, index) => ({
        text,
        score:
          results.distances?.[0]?.[index] ?? 0,
      })
    ) || []
  );
};

const buildPrompt = (
  question,
  contextBlocks,
  history = []
) => {
  const historyBlock =
    history.length > 0
      ? history
          .slice(-6)
          .map(
            (entry) =>
              `${
                entry.role === "user"
                  ? "User"
                  : "Assistant"
              }: ${entry.content}`
          )
          .join("\n")
      : "No previous conversation.";

  const context = contextBlocks
    .map((chunk) => chunk.text)
    .join("\n\n");

  return `
    You are a hostel information assistant.

    Answer only using the provided context.

    If the answer is not present in the context, say:
    "I do not have enough information to answer that."

    Keep answers short and direct.

    Conversation History:
    ${historyBlock}

    Context:
    ${context}

    Question:
    ${question}
    `;
};

const callGemini = async (prompt) => {
  const apiKey =
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json();

  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("\n")
      .trim() || ""
  );
};

router.post(
  "/query",
  async (req, res) => {
    try {
      const message = String(
        req.body?.message || ""
      ).trim();

      const history = Array.isArray(
        req.body?.history
      )
        ? req.body.history
        : [];

      if (!message) {
        return res.status(400).json({
          error: "Message is required",
        });
      }

      const topChunks =
        await retrieveTopChunks(
          message,
          4
        );

      const prompt = buildPrompt(
        message,
        topChunks,
        history
      );

      const answer =
      topChunks[0]?.text ||
      "I do not have enough information.";

      // const answer =callGemini(prompt);

      return res.json({
        success: true,
        answer,
        sources: topChunks.map(
          (chunk) => ({
            score: Number(
              chunk.score.toFixed(4)
            ),
          })
        ),
      });
    } catch (error) {
      console.error(
        "Chatbot error:",
        error
      );

      return res.status(500).json({
        error:
          "Unable to generate chatbot response",
      });
    }
  }
);

export default router;