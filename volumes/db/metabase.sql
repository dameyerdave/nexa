\set pguser `echo "$POSTGRES_USER"`

-- Metabase's own application database (dashboards, questions, users, etc.)
-- lives on this same Postgres server, in its own database, alongside the
-- actual business data it queries for analytics - see _supabase.sql for
-- the identical pattern this follows.
CREATE DATABASE metabase WITH OWNER :pguser;
