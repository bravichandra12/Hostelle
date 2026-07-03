import express from "express";
import pool from "../db.js";
import { classifyComplaint } from "../services/complaintScoring.js";

const router = express.Router();
let complaintColumnsEnsured = false;

const ensureComplaintTriageColumns = async () => {
  if (complaintColumnsEnsured) return;

  await pool.query(`
    ALTER TABLE complaints
    ADD COLUMN IF NOT EXISTS priority_score INTEGER NOT NULL DEFAULT 0
  `);

  await pool.query(`
    ALTER TABLE complaints
    ADD COLUMN IF NOT EXISTS complexity_label VARCHAR(20) NOT NULL DEFAULT 'Low'
  `);

  await pool.query(`
    ALTER TABLE complaints
    ALTER COLUMN complexity_label SET DEFAULT 'Low'
  `);

  await pool.query(`
    UPDATE complaints
    SET complexity_label = CASE
      WHEN complexity_label IN ('P0 Emergency', 'P1 High') THEN 'High'
      WHEN complexity_label = 'P2 Medium' THEN 'Mid'
      WHEN complexity_label = 'P3 Low' THEN 'Low'
      ELSE complexity_label
    END
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaint_assignments (
      id SERIAL PRIMARY KEY,
      complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
      caretaker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      UNIQUE(complaint_id, caretaker_id)
    )
  `);

  complaintColumnsEnsured = true;
};

const normalizeGroupedComplaintsInput = (body) => {
  const source = body?.grouped_complaints ?? body?.groupedComplaints ?? body;

  if (Array.isArray(source)) {
    const grouped = {};
    source.forEach((item) => {
      const category = String(item?.category || "others/wildlife").trim();
      const items = Array.isArray(item?.complaints) ? item.complaints : [];
      grouped[category] = (grouped[category] || []).concat(items);
    });
    return grouped;
  }

  if (source && typeof source === "object") {
    return source;
  }

  return null;
};

const VALID_TYPES = new Set([
  "electrical",
  "plumbing",
  "lan",
  "carpenter",
  "cleaning",
  "insects",
  "others",
]);

router.post("/", async (req, res) => {
  try {
    const { userId, complaintType, description, location } = req.body;

    if (!userId || !complaintType || !description || !location) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const normalizedType = String(complaintType || "").toLowerCase();
    if (!VALID_TYPES.has(normalizedType)) {
      return res.status(400).json({ error: "Invalid complaint type" });
    }

    const userResult = await pool.query(
      "SELECT id, role, hostel FROM users WHERE id = $1",
      [userId]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];
    if (user.role !== "student") {
      return res.status(403).json({ error: "Only students can submit complaints" });
    }

    await ensureComplaintTriageColumns();

    const normalizedComplaint = {
      complaint_id: null,
      category: normalizedType,
      complaint_text: String(description).trim(),
      location: String(location).trim(),
      created_at: new Date().toISOString(),
    };

    const triage = await classifyComplaint(normalizedComplaint);

    const insert = `
      INSERT INTO complaints (user_id, complaint_type, description, location, priority_score, complexity_label)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, complaint_type, description, location, status, created_at, priority_score, complexity_label
    `;

    const values = [
      userId,
      normalizedType,
      normalizedComplaint.complaint_text,
      normalizedComplaint.location,
      triage.computed_score,
      triage.priority_label,
    ];

    const { rows } = await pool.query(insert, values);
    const complaintId = rows[0].id;

    // Find all caretakers for the same hostel
    const caretakersResult = await pool.query(
      "SELECT id FROM users WHERE role = 'caretaker' AND hostel = $1",
      [user.hostel]
    );

    // Assign complaint to all caretakers of the same hostel
    for (const caretaker of caretakersResult.rows) {
      await pool.query(
        "INSERT INTO complaint_assignments (complaint_id, caretaker_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [complaintId, caretaker.id]
      );
    }

    return res.status(201).json({ success: true, complaint: rows[0], triage });
  } catch (error) {
    console.error("Complaint create error", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const caretakerId = Number(req.query.userId);
    if (!caretakerId) {
      return res.status(400).json({ error: "Caretaker userId is required" });
    }

    const caretakerResult = await pool.query(
      "SELECT id, role FROM users WHERE id = $1",
      [caretakerId]
    );

    if (!caretakerResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    if (caretakerResult.rows[0].role !== "caretaker") {
      return res.status(403).json({ error: "Only caretakers can view complaints" });
    }

    await ensureComplaintTriageColumns();

    const { rows } = await pool.query(
      `SELECT c.id,
              c.user_id AS student_id,
              c.complaint_type,
              c.description,
              c.location,
              c.status,
              c.created_at,
              c.priority_score,
              c.complexity_label,
              u.name AS student_name,
              split_part(lower(u.email), '@', 1) AS student_username,
              u.hostel
       FROM complaints c
       JOIN users u ON u.id = c.user_id
       JOIN complaint_assignments ca ON ca.complaint_id = c.id
       WHERE ca.caretaker_id = $1
       ORDER BY
         CASE c.complexity_label
           WHEN 'High' THEN 0
           WHEN 'Mid' THEN 1
           WHEN 'Low' THEN 2
           WHEN 'P0 Emergency' THEN 0
           WHEN 'P1 High' THEN 0
           WHEN 'P2 Medium' THEN 1
           WHEN 'P3 Low' THEN 2
           ELSE 2
         END ASC,
         (c.priority_score + (EXTRACT(EPOCH FROM (now() - c.created_at)) / 3600) * 1.0) DESC,
         c.created_at DESC`,
      [caretakerId]
    );

    return res.json({ success: true, complaints: rows });
  } catch (error) {
    console.error("Complaint list error", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const complaintId = Number(req.params.id);
    const caretakerId = Number(req.body?.caretakerId ?? req.query?.caretakerId);

    if (!complaintId) {
      return res.status(400).json({ error: "Invalid complaint id" });
    }

    if (!caretakerId) {
      return res.status(400).json({ error: "Caretaker id is required" });
    }

    const caretakerResult = await pool.query(
      "SELECT id, role FROM users WHERE id = $1",
      [caretakerId]
    );

    if (!caretakerResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    if (caretakerResult.rows[0].role !== "caretaker") {
      return res.status(403).json({ error: "Only caretakers can resolve complaints" });
    }

    // Verify the complaint is assigned to this caretaker
    const assignmentResult = await pool.query(
      "SELECT id FROM complaint_assignments WHERE complaint_id = $1 AND caretaker_id = $2",
      [complaintId, caretakerId]
    );

    if (!assignmentResult.rows.length) {
      return res.status(403).json({ error: "This complaint is not assigned to you" });
    }

    const deleteResult = await pool.query(
      "DELETE FROM complaints WHERE id = $1 RETURNING id",
      [complaintId]
    );

    if (!deleteResult.rows.length) {
      return res.status(404).json({ error: "Complaint not found" });
    }

    return res.json({ success: true, deletedId: deleteResult.rows[0].id });
  } catch (error) {
    console.error("Complaint resolve error", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.delete("/", async (req, res) => {
  return res.status(400).json({ error: "Invalid complaint id" });
});

router.post("/prioritize", async (req, res) => {
  try {
    const groupedInput = normalizeGroupedComplaintsInput(req.body);
    if (!groupedInput || typeof groupedInput !== "object") {
      return res.status(400).json({
        error:
          "Invalid input. Send grouped complaints as { categoryName: [complaints...] } or { groupedComplaints: ... }",
      });
    }

    const categories = Object.keys(groupedInput);
    const resultByCategory = {};
    let totalComplaints = 0;
    let totalExtractionFailures = 0;

    for (const category of categories) {
      const complaints = Array.isArray(groupedInput[category]) ? groupedInput[category] : [];
      const prioritized = [];
      totalComplaints += complaints.length;

      for (let index = 0; index < complaints.length; index += 1) {
        const complaint = complaints[index] || {};
        const normalizedComplaint = {
          complaint_id: complaint.complaint_id ?? complaint.id ?? null,
          category: complaint.category ?? category,
          complaint_text: complaint.complaint_text ?? complaint.description ?? "",
          location: complaint.location ?? "",
          created_at: complaint.created_at ?? null,
          ...complaint,
        };

        const triage = await classifyComplaint(normalizedComplaint);
        if (triage.extraction_error) {
          totalExtractionFailures += 1;
          console.error("Complaint prioritization extraction error", {
            complaint_id: normalizedComplaint.complaint_id,
            category,
            error: triage.extraction_error,
          });
        }

        prioritized.push({
          ...normalizedComplaint,
          ...triage,
        });
      }

      prioritized.sort((a, b) => {
        const priorityRank = {
          High: 0,
          Mid: 1,
          Low: 2,
        };
        const aRank = priorityRank[a.priority_label] ?? 99;
        const bRank = priorityRank[b.priority_label] ?? 99;
        if (aRank !== bRank) return aRank - bRank;
        return Number(b.computed_score || 0) - Number(a.computed_score || 0);
      });

      resultByCategory[category] = prioritized.map((item, idx) => ({
        ...item,
        sorted_order: idx + 1,
      }));
    }

    if (totalComplaints > 0 && totalExtractionFailures === totalComplaints) {
      return res.status(502).json({
        error:
          "Groq parameter extraction failed for all complaints. Check GROQ_API_KEY, model access, or API quota.",
      });
    }

    return res.json({
      success: true,
      grouped_complaints: resultByCategory,
      priority_order: ["High", "Mid", "Low"],
      extraction_summary: {
        total_complaints: totalComplaints,
        extraction_failures: totalExtractionFailures,
      },
    });
  } catch (error) {
    console.error("Complaint prioritization error", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.use((req, res) => {
  res.status(404).json({ error: "Complaints route not found" });
});

export default router;
