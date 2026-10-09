-- Repair wheels stuck with every active prize at weight 0 (unspinable:
-- the public page renders 0% slices and the spin API rejects with
-- "No reward available for this campaign."). Only campaigns whose active
-- weight sum is exactly 0 are touched; healthy campaigns are untouched and
-- "none"/inactive rows keep weight 0.
UPDATE rewards
SET weight = CASE name
      WHEN 'Prochaine visite' THEN 20
      WHEN 'Café offert' THEN 15
      WHEN '10% aujourd’hui' THEN 10
      WHEN 'Points x2' THEN 20
      WHEN 'Cadeau surprise' THEN 10
      WHEN 'Retentez votre chance' THEN 25
      ELSE weight
    END,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE active = 1
  AND weight = 0
  AND type <> 'none'
  AND campaign_id IN (
    SELECT r.campaign_id
    FROM rewards r
    GROUP BY r.campaign_id
    HAVING COALESCE(SUM(CASE WHEN r.active = 1 THEN r.weight ELSE 0 END), 0) = 0
  );
