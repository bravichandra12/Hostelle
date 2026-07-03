import express from "express";
import pool from "../db.js";

const router = express.Router();

//APPLY FINE (USING ROLL NUMBER)
router.post("/apply", async (req, res) => {
  try {
    const { caretakerId, rollNo, description, amount } = req.body;
    console.log("BODY RECEIVED:", req.body);
    // Validation
    if (!caretakerId || !rollNo || !description || amount === undefined) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than 0" });
    }

    // Check caretaker
    const caretakerResult = await pool.query(
      "SELECT id, role FROM users WHERE id = $1",
      [caretakerId]
    );

    if (caretakerResult.rows.length === 0) {
      return res.status(404).json({ error: "Caretaker not found" });
    }

    if (caretakerResult.rows[0].role !== "caretaker") {
      return res.status(403).json({ error: "Only caretakers can apply fines" });
    }

    //FIND STUDENT USING ROLL NO
    const studentResult = await pool.query(
      "SELECT id, email FROM users WHERE LOWER(roll_no) = LOWER($1) AND role = 'student'",
      [rollNo.trim()]
    );

    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    const student = studentResult.rows[0];

    //INSERT FINE
    const fineQuery = `
      INSERT INTO fines (caretaker_id, student_email, description, amount, status)
      VALUES ($1, $2, $3, $4, 'pending')
      RETURNING id, caretaker_id, student_email, description, amount, status, created_at
    `;

    const fineResult = await pool.query(fineQuery, [
      caretakerId,
      student.email,
      description,
      parseFloat(amount),
    ]);

    await pool.query(
      `INSERT INTO notifications (user_id, type, message)
       VALUES ($1, 'fine', $2)`,
      [
        student.id,
        `You have been fined ₹${amount} for: ${description}`,
      ]
    );

    res.json({
      success: true,
      message: "Fine applied successfully",
      fine: fineResult.rows[0],
    });

  } catch (error) {
    console.error("Error applying fine:", error);
    res.status(500).json({ error: "Server error while applying fine" });
  }
});


//GET FINES FOR STUDENT USING ROLL NO
router.get("/student/:rollNo", async (req, res) => {
  try {
    const { rollNo } = req.params;

    //Get student email from roll_no
    const userResult = await pool.query(
      "SELECT email FROM users WHERE LOWER(roll_no) = LOWER($1)",
      [rollNo]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    const email = userResult.rows[0].email;

    const query = `
      SELECT f.*, u.name as caretaker_name
      FROM fines f
      JOIN users u ON f.caretaker_id = u.id
      WHERE LOWER(f.student_email) = LOWER($1)
      ORDER BY f.created_at DESC
    `;

    const result = await pool.query(query, [email]);

    res.json({
      success: true,
      fines: result.rows,
      totalAmount: result.rows.reduce(
        (sum, fine) => sum + parseFloat(fine.amount),
        0
      ),
    });

  } catch (error) {
    console.error("Error fetching fines:", error);
    res.status(500).json({ error: "Server error while fetching fines" });
  }
});


//GET ALL FINES BY CARETAKER
router.get("/caretaker/:caretakerId", async (req, res) => {
  try {
    const { caretakerId } = req.params;

    const query = `
      SELECT *
      FROM fines
      WHERE caretaker_id = $1 AND status = 'pending'
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [caretakerId]);

    res.json({
      success: true,
      fines: result.rows,
    });

  } catch (error) {
    console.error("Error fetching caretaker fines:", error);
    res.status(500).json({ error: "Server error while fetching fines" });
  }
});


// MARK FINE AS PAID
router.put("/:fineId/mark-paid", async (req, res) => {
  try {
    const { fineId } = req.params;

    const result = await pool.query(
      `
      UPDATE fines
      SET status = 'paid', paid_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [fineId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Fine not found" });
    }

    res.json({
      success: true,
      message: "Fine marked as paid",
      fine: result.rows[0],
    });

  } catch (error) {
    console.error("Error marking fine as paid:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// CANCEL FINE
router.put("/:fineId/cancel", async (req, res) => {
  try {
    const { fineId } = req.params;

    const result = await pool.query(
      `
      UPDATE fines
      SET status = 'cancelled'
      WHERE id = $1
      RETURNING *
      `,
      [fineId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Fine not found" });
    }

    res.json({
      success: true,
      message: "Fine cancelled",
      fine: result.rows[0],
    });

  } catch (error) {
    console.error("Error cancelling fine:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;