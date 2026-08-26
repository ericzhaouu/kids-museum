-- Authentication tables are intentionally not seeded directly because their internal schema
-- changes with GoTrue versions. After reset, tools/setup-local-resources.mjs uses the loopback
-- Admin API to create an idempotent local curator and synthetic placeholder records.
select 'kids-museum local seed v1' as seed_status;
