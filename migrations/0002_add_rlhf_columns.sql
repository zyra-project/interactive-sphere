-- Add RLHF context columns for training data extraction
ALTER TABLE feedback ADD COLUMN system_prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE feedback ADD COLUMN model_config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE feedback ADD COLUMN is_fallback INTEGER NOT NULL DEFAULT 0;
