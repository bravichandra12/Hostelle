const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

export const PRIORITY_RANK = {
  High: 0,
  Mid: 1,
  Low: 2,
};

const DEFAULT_EXTRACTED = {
  safety_risk: 0,
  outage_severity: 0,
  people_affected: 0,
  time_sensitivity: 0,
  vulnerable_location: 0,
  emergency_flag: false,
  sla_escalation: 0,
};

const asBoundedInt = (value, min = 0, max = 5) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, Math.round(parsed)));
};

const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "yes", "1"].includes(lowered)) return true;
    if (["false", "no", "0", ""].includes(lowered)) return false;
  }
  return false;
};

const stripCodeFence = (text) =>
  String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

const parseLlmJson = (text) => {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const candidate = cleaned.slice(firstBrace, lastBrace + 1);
      return JSON.parse(candidate);
    }
    throw new Error("LLM returned non-JSON output");
  }
};

const normalizeExtraction = (raw) => ({
  safety_risk: asBoundedInt(raw?.safety_risk, 0, 5),
  outage_severity: asBoundedInt(raw?.outage_severity, 0, 5),
  people_affected: asBoundedInt(raw?.people_affected, 0, 5),
  time_sensitivity: asBoundedInt(raw?.time_sensitivity, 0, 5),
  vulnerable_location: asBoundedInt(raw?.vulnerable_location, 0, 5),
  emergency_flag: parseBoolean(raw?.emergency_flag),
  sla_escalation: asBoundedInt(raw?.sla_escalation, 0, 5),
});

export const computeScore = (params) =>
  5 * params.safety_risk +
  4 * params.outage_severity +
  3 * params.people_affected +
  3 * params.time_sensitivity +
  2 * params.vulnerable_location +
  params.sla_escalation;

const hasCriticalEmergencySignals = (complaint) => {
  const category = String(complaint?.category || "").toLowerCase();
  const text = `${complaint?.complaint_text || ""} ${complaint?.location || ""}`.toLowerCase();

  const genericEmergencyPatterns = [
    /fire|flames?|smoke|burning\s+smell|gas\s+leak/,
    /electrocution|electric\s+shock|shock\s+hazard/,
    /short\s*circuit|shorting/,
    /live\s+wire|exposed\s+wire|current\s+leakage/,
    /collapse|falling\s+ceiling|major\s+flood/,
  ];

  if (genericEmergencyPatterns.some((pattern) => pattern.test(text))) {
    return true;
  }

  if (category === "electrical") {
    const sparkPattern = /sparks?|sparking/;
    const boardPattern = /switch\s*board|switchboard|mcb\s*panel|electrical\s*panel/;
    if (sparkPattern.test(text) && boardPattern.test(text)) {
      return true;
    }
  }

  return false;
};

export const mapPriorityLabel = (params, score) => {
  if (params.emergency_flag === true || score >= 40) return "High";
  if (score >= 12) return "Mid";
  return "Low";
};

const buildExtractionPrompt = (complaint) => `You are a hostel complaint triage engine.

Task:
Return ONLY one JSON object with EXACT keys:
- safety_risk (integer 0-5)
- outage_severity (integer 0-5)
- people_affected (integer 0-5)
- time_sensitivity (integer 0-5)
- vulnerable_location (integer 0-5)
- emergency_flag (boolean)
- sla_escalation (integer 0-5)

Scoring rubric:
1) safety_risk:
- 0: no safety concern
- 1: minor discomfort only
- 2: low hazard
- 3: moderate injury risk
- 4: high risk (electrical short, gas smell, water near live wires)
- 5: immediate life-threatening risk (fire/smoke, electrocution danger, structural collapse)

2) outage_severity:
- 0: no outage
- 1: tiny inconvenience
- 2: affects one room/small area
- 3: affects floor/common utility
- 4: affects major building function
- 5: hostel-wide critical outage

3) people_affected:
- 0: single person
- 1: 2-3 people
- 2: a room/small group
- 3: one wing/floor
- 4: large part of hostel
- 5: entire hostel/many residents

4) time_sensitivity:
- 0: can wait days
- 1: low urgency
- 2: resolve within 24-48h
- 3: same-day preferred
- 4: needs action in hours
- 5: immediate action required

5) vulnerable_location:
- 0: non-critical area
- 1: normal room/corridor
- 2: shared area
- 3: essential utility area
- 4: high-use critical area (mess entrance, stairs, main corridor)
- 5: highly sensitive area with elevated risk potential

6) emergency_flag rules:
- true ONLY if immediate threat exists: active fire/smoke, electrocution risk, major flooding near power, gas leak, structural collapse, violent wildlife attack.
- for electrical category, any sparking from switchboard/switch board/MCB panel MUST be emergency_flag = true.
- otherwise false.

7) sla_escalation:
- 0: no escalation needed
- 1: normal queue
- 2: faster handling
- 3: urgent follow-up
- 4: same-shift escalation
- 5: immediate escalation to senior/caretaker on duty

Calibration constraints:
- Be conservative with 4-5 values; do not over-score routine complaints.
- Use only complaint text + location + category. Do not invent facts.
- If details are vague, choose moderate values (1-3), not extreme.

Complaint data:
complaint_id: ${complaint.complaint_id}
category: ${complaint.category}
complaint_text: ${complaint.complaint_text}
location: ${complaint.location}
created_at: ${complaint.created_at}

Return JSON only. No markdown. No explanation.`;

const extractWithGroq = async (complaint) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Groq API key is not configured");
  }

  const endpoint = "https://api.groq.com/openai/v1/chat/completions";
  const prompt = buildExtractionPrompt(complaint);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0,
      max_tokens: 220,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a strict JSON generator for hostel triage. Return only one valid JSON object with exact required keys and correct primitive types.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq request failed: ${response.status} ${body}`);
  }

  const payload = await response.json();
  const text = String(payload?.choices?.[0]?.message?.content || "").trim();

  if (!text) {
    throw new Error("Groq returned empty response");
  }

  const parsed = parseLlmJson(text);
  return normalizeExtraction(parsed);
};

export const classifyComplaint = async (complaint) => {
  let extracted = DEFAULT_EXTRACTED;
  let extractionError = null;

  try {
    extracted = await extractWithGroq(complaint);
  } catch (error) {
    extractionError = error.message;
  }

  const emergencyByRule = hasCriticalEmergencySignals(complaint);
  const effectiveParams = emergencyByRule
    ? {
      ...extracted,
      emergency_flag: true,
      safety_risk: Math.max(extracted.safety_risk, 5),
      time_sensitivity: Math.max(extracted.time_sensitivity, 5),
      sla_escalation: Math.max(extracted.sla_escalation, 5),
    }
    : extracted;

  const computedScore = computeScore(effectiveParams);
  const priorityLabel = mapPriorityLabel(effectiveParams, computedScore);

  return {
    ...effectiveParams,
    emergency_rule_triggered: emergencyByRule,
    computed_score: computedScore,
    priority_label: priorityLabel,
    extraction_error: extractionError,
  };
};