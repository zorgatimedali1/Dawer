-- P2-7 proximity soft signal: the campaign's resolved place coordinates and
-- the per-spin distance from the customer's reported position. Soft only —
-- NULL means "no signal", it never blocks a spin.
ALTER TABLE campaigns ADD COLUMN latitude REAL;
ALTER TABLE campaigns ADD COLUMN longitude REAL;
ALTER TABLE participations ADD COLUMN distance_meters REAL;
ALTER TABLE spin_events ADD COLUMN distance_meters REAL;
