import express from "express";
import crypto from "crypto";
import { getDistance } from "geolib";
import nodemailer from "nodemailer";
import pool from "../db.js";
import redis from "../redis/redisClient.js";

const router = express.Router();

const HOSTEL_LOCATION = {
  latitude: 23.176621479804552,
  longitude: 80.01962910588388,
};
const RADIUS_METERS = 200;
const OTP_TTL_SECONDS = 30;

const maskEmail = (email) => {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "your email";
  const maskedName = `${name.slice(0, 2)}***${name.slice(-1)}`;
  return `${maskedName}@${domain}`;
};

const getMailer = () => {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
};

const buildOtpMessage = (otp) =>
  `Your Hostel Attendance OTP is ${otp}. It is valid for ${OTP_TTL_SECONDS} seconds.`;
  

router.post("/request-otp", async (req, res) => {
  const { userId, latitude, longitude, accuracy } = req.body;

  if (!userId || typeof latitude !== "number" || typeof longitude !== "number") {
    return res.status(400).json({ message: "User ID and GPS location are required." });
  }

  if (accuracy && accuracy > 400) {
    return res.status(400).json({ message: "GPS accuracy is too low. Try again from an open area." });
  }

  try {
    const userResult = await pool.query("SELECT id, email FROM users WHERE id = $1", [userId]);
    if (!userResult.rows.length) {
      return res.status(404).json({ message: "User not found." });
    }

    const distance = getDistance({ latitude, longitude }, HOSTEL_LOCATION);
    if (distance > RADIUS_METERS) {
      return res.status(403).json({ message: "You are outside the hostel area." });
    }

    const todayResult = await pool.query(
      "SELECT id FROM attendance WHERE user_id = $1 AND attendance_date = CURRENT_DATE",
      [userId]
    );

    if (todayResult.rows.length) {
      return res.status(409).json({ message: "Attendance already marked for today." });
    }

    const mailer = getMailer();
    if (!mailer) {
      return res.status(500).json({ message: "SMTP is not configured on the server." });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    console.log(`${otp}`);
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    const otpData = {
      otpHash,
      latitude,
      longitude,
      accuracy: accuracy || null,
    };

    await redis.setEx(
      `attendance:${userId}`,
      OTP_TTL_SECONDS,
      JSON.stringify(otpData)
    );

    const userEmail = userResult.rows[0].email;
    const from = process.env.SMTP_FROM || process.env.SMTP_USER;

    await mailer.sendMail({
      from,
      to: userEmail,
      subject: "Your Hostel Attendance OTP",
      text: buildOtpMessage(otp),
    });

    return res.json({
      message: `OTP sent to ${maskEmail(userEmail)}.`,
      expiresIn: OTP_TTL_SECONDS,
    });
  } catch (error) {
    console.error("Attendance OTP error", error);
    return res.status(500).json({ message: "Server error while sending OTP." });
  }
});

router.post("/verify-otp", async (req, res) => {
  const { userId, otp } = req.body;
    
  if (!userId || !otp) {
    return res.status(400).json({ message: "User and OTP are required." });
  }

  try {
    const cachedOtp = await redis.get(`attendance:${userId}`);

    if (!cachedOtp) {
      return res.status(410).json({ message: "OTP expired. Please request a new one." });
    }

    const otpRow = JSON.parse(cachedOtp);

    const incomingHash = crypto.createHash("sha256").update(String(otp)).digest("hex");
    if (incomingHash !== otpRow.otpHash) {
      return res.status(401).json({ message: "Invalid OTP." });
    }

    const todayResult = await pool.query(
      "SELECT id FROM attendance WHERE user_id = $1 AND attendance_date = CURRENT_DATE",
      [userId]
    );

    if (todayResult.rows.length) {
      return res.status(409).json({ message: "Attendance already marked for today." });
    }

    await pool.query(
      `INSERT INTO attendance (user_id, latitude, longitude, accuracy)
       VALUES ($1, $2, $3, $4)`,
      [
        userId,
        otpRow.latitude,
        otpRow.longitude,
        otpRow.accuracy,
      ]
    );

    await redis.del(`attendance:${userId}`);

    return res.json({ message: "Attendance marked successfully." });
  } catch (error) {
    console.error("Attendance OTP verify error", error);
    return res.status(500).json({ message: "Server error while verifying OTP." });
  }
});

router.get("/user/:userId", async (req, res) => {
  const userId = Number(req.params.userId);
  if (!userId) {
    return res.status(400).json({ message: "Invalid user id." });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, attended_at, attendance_date
       FROM attendance
       WHERE user_id = $1
       ORDER BY attended_at DESC
       LIMIT 10`,
      [userId]
    );
    return res.json({ success: true, attendance: rows });
  } catch (error) {
    console.error("Attendance lookup error", error);
    return res.status(500).json({ message: "Server error." });
  }
});

router.get("/today", async (req, res) => {
  try {
    const markedResult = await pool.query(
      `SELECT DISTINCT u.name
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE a.attendance_date = CURRENT_DATE
       ORDER BY u.name ASC`
    );

    const unmarkedResult = await pool.query(
      `SELECT u.name
       FROM users u
       WHERE u.role = 'student'
         AND NOT EXISTS (
           SELECT 1
           FROM attendance a
           WHERE a.user_id = u.id
             AND a.attendance_date = CURRENT_DATE
         )
       ORDER BY u.name ASC`
    );

    return res.json({
      success: true,
      markedNames: markedResult.rows.map((row) => row.name),
      unmarkedNames: unmarkedResult.rows.map((row) => row.name),
    });
  } catch (error) {
    console.error("Attendance today lookup error", error);
    return res.status(500).json({ message: "Server error." });
  }
});

router.use((req, res) => {
  res.status(404).json({ message: "Attendance route not found" });
});

export default router;
