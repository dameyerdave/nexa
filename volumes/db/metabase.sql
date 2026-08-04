\set pguser `echo "$POSTGRES_USER"`

-- Metabase's own application database (dashboards, questions, users, etc.)
-- lives on this same Postgres server, in its own database, alongside the
-- actual business data it queries for analytics - see _supabase.sql for
-- the identical pattern this follows.
CREATE DATABASE metabase WITH OWNER :pguser;

-- WITH OWNER above doesn't by itself grant rights on the new database's
-- `public` schema - Supabase's own migrations harden the default template
-- by revoking CREATE on `public` from the PUBLIC pseudo-role, so it needs
-- an explicit grant or Metabase's own schema migrations (Liquibase) fail
-- with "permission denied for schema public" on first boot.
\connect metabase
GRANT ALL ON SCHEMA public TO :pguser;
