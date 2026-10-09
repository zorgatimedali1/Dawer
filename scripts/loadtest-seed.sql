-- Seed for the local load test (scripts/loadtest.mjs).
-- Idempotent: wipes any previous load-test rows first.
DELETE FROM spin_events WHERE campaign_id = 'loadtest-camp-0001';
DELETE FROM spin_claims WHERE campaign_id = 'loadtest-camp-0001';
DELETE FROM action_claims WHERE campaign_id = 'loadtest-camp-0001';
DELETE FROM participations WHERE campaign_id = 'loadtest-camp-0001';
DELETE FROM rewards WHERE campaign_id = 'loadtest-camp-0001';
DELETE FROM campaigns WHERE id = 'loadtest-camp-0001';
DELETE FROM subscriptions WHERE id = 'loadtest-sub-0001';
DELETE FROM businesses WHERE id = 'loadtest-biz-0001';
DELETE FROM customers WHERE business_id = 'loadtest-biz-0001';

INSERT INTO businesses (id, name, slug, timezone, created_at, updated_at)
VALUES ('loadtest-biz-0001', 'Load Test Shop', 'load-test-shop', 'UTC',
        '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z');

INSERT INTO subscriptions (id, business_id, plan_id, status, current_period_end, created_at, updated_at)
VALUES ('loadtest-sub-0001', 'loadtest-biz-0001', 'plan_growth', 'active',
        '2030-01-01T00:00:00.000Z', '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z');

INSERT INTO campaigns (id, business_id, name, description, public_code, status, start_at, end_at,
                       game_type, require_customer_information, require_action, play_rules,
                       created_at, updated_at)
VALUES ('loadtest-camp-0001', 'loadtest-biz-0001', 'Load Spin', 'Load test campaign', 'LDTEST000001',
        'ACTIVE', NULL, NULL, 'WHEEL', 0, 'NONE', NULL,
        '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z');

INSERT INTO rewards (id, business_id, campaign_id, name, type, value, description,
                     quantity, quantity_initial, weight, active, created_at, updated_at)
VALUES ('loadtest-rw-0001', 'loadtest-biz-0001', 'loadtest-camp-0001', 'Free coffee', 'free_product', '1',
        'Load test reward', 999999, 999999, 100, 1,
        '2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z');
