-- Metabase's own application database (dashboards, questions, users, etc.)
-- lives on this same Postgres server, in its own database, alongside the
-- actual business data it queries for analytics - see _supabase.sql for
-- the identical pattern this follows.
--
-- Owned by (and granted to) the literal `postgres` role, not the
-- $POSTGRES_USER running this script - Supabase's own bootstrap superuser
-- is `supabase_admin`, not `postgres`, so `$POSTGRES_USER` resolves to the
-- former while Metabase (MB_DB_USER) connects as the latter. WITH OWNER
-- alone also isn't enough: Supabase's own migrations harden the default
-- template by revoking CREATE on `public` from the PUBLIC pseudo-role, so
-- `postgres` needs an explicit grant too, or Metabase's schema migrations
-- (Liquibase) fail with "permission denied for schema public" on boot.
CREATE DATABASE metabase WITH OWNER postgres;
\connect metabase
GRANT ALL ON SCHEMA public TO postgres;
