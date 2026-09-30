-- Rewards stock tracking: `quantity` becomes the remaining stock, `quantity_initial` the original.
ALTER TABLE rewards ADD COLUMN quantity_initial INTEGER;

UPDATE rewards SET quantity_initial = quantity WHERE quantity_initial IS NULL;
