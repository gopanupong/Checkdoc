-- Cloudflare D1 Database Schema for PEA Official Letter Verifier

-- Table to store uploaded documents metadata
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY, -- UUID
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  google_drive_link TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table to store AI analysis and verification results
CREATE TABLE IF NOT EXISTS analysis_results (
  id TEXT PRIMARY KEY, -- UUID
  document_id TEXT NOT NULL,
  original_text TEXT NOT NULL,
  status TEXT NOT NULL, -- 'pass' or 'fail'
  warning_message TEXT, -- Store raw JSON array of issues for easy parsing
  recommended_text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents (id) ON DELETE CASCADE
);
