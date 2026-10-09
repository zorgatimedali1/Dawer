-- Per-campaign pacing: the sender sleeps message_delay_ms between recipients
-- (fast 150 ms / standard 900 ms / relaxed 3000 ms). Existing rows keep the
-- historical 150 ms behaviour.
ALTER TABLE whatsapp_campaigns ADD COLUMN message_delay_ms INTEGER NOT NULL DEFAULT 150;
