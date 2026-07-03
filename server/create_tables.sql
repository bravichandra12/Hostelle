-- PostgreSQL schema for HackByte user registration
-- Run this in pgAdmin (or psql) as a superuser to create the database + role

-- 0. Create database + role (run in postgres DB or pgAdmin Query Tool)
CREATE DATABASE hackbyte;

CREATE ROLE hackbyte_user LOGIN PASSWORD 'ChangeThisPassword';
GRANT ALL PRIVILEGES ON DATABASE hackbyte TO hackbyte_user;

\c hackbyte;  -- reconnect to the new database (psql syntax)

-- 1. Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'caretaker')),
  email VARCHAR(255) NOT NULL UNIQUE,
  roll_no VARCHAR(50) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  hostel VARCHAR(50) NOT NULL CHECK (hostel IN ('H4', 'H3', 'H1', 'Panini', 'Ma Saraswati')),
  phone VARCHAR(20) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 2. Simple test data
INSERT INTO users (role, email, roll_no, password_hash, name, hostel, phone)
VALUES
  ('student', 'alice@college.edu', 'alice', '$2b$10$/lNP/CUx78RoDMoBFmWqbeji9CcfPhbSNjTWdWJFnDGKpf7pPgNli', 'Alice Johnson', 'H4', '9876543210'),
  ('caretaker', 'bob@college.edu', 'bob', '$2b$10$7cgXdP8iYcl16emzp5hMq.QPX/Fmp7r10TrlD8pyXvesNF64359YC', 'Bob Verma', 'Ma Saraswati', '9123456780')
ON CONFLICT DO NOTHING;

-- 3. Query for validation
SELECT * FROM users ORDER BY created_at DESC;

-- 4. Lost and found items
CREATE TABLE IF NOT EXISTS lost_found_items (
  id SERIAL PRIMARY KEY,
  item_type VARCHAR(10) NOT NULL CHECK (item_type IN ('lost', 'found')),
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  hostel VARCHAR(50) NOT NULL,
  location VARCHAR(200),
  contact_phone VARCHAR(20),
  image_url TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claimed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claimed_at TIMESTAMP WITH TIME ZONE,
  claim_proof_image_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 6. Attendance tracking
CREATE TABLE IF NOT EXISTS attendance (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  attended_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 7. Attendance OTPs (short-lived)
CREATE TABLE IF NOT EXISTS attendance_otps (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  accuracy DOUBLE PRECISION,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- 8. Complaints
CREATE TABLE IF NOT EXISTS complaints (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  complaint_type VARCHAR(20) NOT NULL CHECK (complaint_type IN ('electrical', 'plumbing', 'lan', 'carpenter', 'cleaning', 'insects', 'others')),
  description TEXT NOT NULL,
  location VARCHAR(200) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE complaints
ADD COLUMN IF NOT EXISTS priority_score INTEGER;

ALTER TABLE complaints
ADD COLUMN IF NOT EXISTS complexity_label VARCHAR(20);

ALTER TABLE complaints
ALTER COLUMN priority_score SET DEFAULT 0,
ALTER COLUMN complexity_label SET DEFAULT 'Low';

UPDATE complaints
SET priority_score = COALESCE(priority_score, 0);

UPDATE complaints
SET complexity_label = CASE
  WHEN complexity_label IN ('P0 Emergency', 'P1 High') THEN 'High'
  WHEN complexity_label = 'P2 Medium' THEN 'Mid'
  WHEN complexity_label = 'P3 Low' THEN 'Low'
  WHEN complexity_label IS NULL OR trim(complexity_label) = '' THEN 'Low'
  ELSE complexity_label
END;

ALTER TABLE complaints
ALTER COLUMN priority_score SET NOT NULL,
ALTER COLUMN complexity_label SET NOT NULL;

-- 9. Complaint Assignments (many-to-many between complaints and caretakers)
CREATE TABLE IF NOT EXISTS complaint_assignments (
  id SERIAL PRIMARY KEY,
  complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  caretaker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(complaint_id, caretaker_id)
);

CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  description TEXT,
  image_url VARCHAR(500),
  hostel VARCHAR(50) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'fulfilled', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS responses (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  responder_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pickup_description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'request_created', 'response_received', 'response_accepted', etc.
  message TEXT NOT NULL,
  related_request_id INTEGER REFERENCES requests(id) ON DELETE CASCADE,
  related_response_id INTEGER REFERENCES responses(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fines (
  id SERIAL PRIMARY KEY,
  caretaker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_email VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  paid_at TIMESTAMP WITH TIME ZONE
);
-- 5. Lost/found queries
-- Create a post (lost or found) - example
INSERT INTO lost_found_items
  (item_type, title, description, hostel, location, user_id, contact_phone, image_url)
VALUES
  ('lost', 'Blue Water Bottle', 'Steel bottle with stickers', 'H4', 'Hostel lobby', 1, '9876543210', NULL)
RETURNING id;

-- Display found posts (for Lost page)
SELECT lfi.*, u.name AS user_name
FROM lost_found_items lfi
LEFT JOIN users u ON u.id = lfi.user_id
WHERE lfi.item_type = 'found'
ORDER BY lfi.created_at DESC;

-- Display lost posts (for Found page)
SELECT lfi.*, u.name AS user_name
FROM lost_found_items lfi
LEFT JOIN users u ON u.id = lfi.user_id
WHERE lfi.item_type = 'lost'
ORDER BY lfi.created_at DESC;
