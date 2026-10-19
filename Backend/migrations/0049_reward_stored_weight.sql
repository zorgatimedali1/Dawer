-- Remembered prize weight for the "Prochaine fois" hand-back.
--
-- Deactivating a prize hands its stored weight to the campaign's "Prochaine
-- fois" slice and zeroes the prize's own weight; this column remembers the
-- original percentage so re-activating the prize can take it back (and let
-- the none slice shrink again).
ALTER TABLE rewards ADD COLUMN stored_weight INTEGER NOT NULL DEFAULT 0;
