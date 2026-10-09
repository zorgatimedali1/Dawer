-- Store the uploaded company logo as image bytes so each business keeps its own photo
CREATE TABLE IF NOT EXISTS business_logos (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  image_data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);