-- Administrative data (audit trail, 2FA secrets, recovery codes, pending
-- registrations) lives here, separate from `public` - so `public` stays
-- just the actual application/imported data, and Metabase (configured to
-- only sync `public` - see README.md "Authentication") never sees any of
-- this. No grants to anon/authenticated here at all, same as these tables
-- always had in `public` - only service_role (the portal's own key) can
-- reach this schema.
create schema if not exists "admin";
grant usage on schema "admin" to service_role;

-- Migrates real data from a pre-"admin"-schema deployment (see
-- portal/server/utils/audit-store.ts for the full explanation) - always a
-- no-op here since this file only ever runs against a brand-new database,
-- kept for consistency with that self-healing copy.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'audit_log')
     and not exists (select 1 from pg_tables where schemaname = 'admin' and tablename = 'audit_log') then
    alter table public.audit_log set schema admin;
  end if;
end $$;

-- PostgREST pre-request hook: copies the X-User-Email header (attached by
-- the portal's Studio identity proxy - see portal/server/utils/studio-proxy.ts -
-- or by the portal's own writes) into a session-local GUC, so the audit
-- trigger below can read who's actually behind a write regardless of
-- which shared Postgres role/connection actually executes it. Stays in
-- `public` - it's global request-handling plumbing, not admin data.
create or replace function "public"."pgrst_pre_request"() returns void as $$
begin
  perform set_config(
    'app.current_user_email',
    coalesce(current_setting('request.headers', true)::json->>'x-user-email', ''),
    true
  );
end;
$$ language plpgsql;

grant execute on function "public"."pgrst_pre_request"() to anon, authenticated, service_role;

-- Generic row-change audit log for every table in `public`.
create table if not exists "admin"."audit_log" (
  id bigint generated always as identity primary key,
  table_name text not null,
  operation text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by text not null default 'unknown',
  changed_at timestamptz not null default now()
);

create or replace function "admin"."audit_trigger_fn"() returns trigger as $$
declare
  actor text;
begin
  actor := coalesce(nullif(current_setting('app.current_user_email', true), ''), 'unknown');
  if (tg_op = 'INSERT') then
    insert into admin.audit_log(table_name, operation, new_data, changed_by)
    values (tg_table_name, tg_op, to_jsonb(new), actor);
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into admin.audit_log(table_name, operation, old_data, new_data, changed_by)
    values (tg_table_name, tg_op, to_jsonb(old), to_jsonb(new), actor);
    return new;
  elsif (tg_op = 'DELETE') then
    insert into admin.audit_log(table_name, operation, old_data, changed_by)
    values (tg_table_name, tg_op, to_jsonb(old), actor);
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = admin;

-- Auto-attaches the audit trigger to every new table created in `public` -
-- whether via Import Excel or directly in Studio's Table Editor - so
-- nothing has to remember to wire this up per table. Only `public` - the
-- `admin` schema's own tables are never row-audited (they're not user
-- data, and audit_log auditing itself would recurse).
create or replace function "public"."attach_audit_trigger"() returns event_trigger as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands() where command_tag = 'CREATE TABLE'
  loop
    if obj.schema_name = 'public' then
      execute format(
        'drop trigger if exists audit_trg on %s; create trigger audit_trg after insert or update or delete on %s for each row execute function admin.audit_trigger_fn()',
        obj.object_identity, obj.object_identity
      );
    end if;
  end loop;
end;
$$ language plpgsql;

drop event trigger if exists audit_attach_trg;
create event trigger audit_attach_trg on ddl_command_end
  when tag in ('CREATE TABLE')
  execute function public.attach_audit_trigger();

-- Free-text search across old/new row data for the admin audit log viewer
-- (server/api/admin/audit.get.ts). PostgREST's URL filter syntax can't
-- cast a jsonb column to text for ilike (confirmed live - "operator does
-- not exist: jsonb ~~* unknown" even with an explicit ::text cast), so
-- this is exposed as an RPC instead - PostgREST supports composing
-- ordinary column filters/order/limit on top of a function that returns
-- setof audit_log, same as querying the table directly (also confirmed
-- live).
create or replace function "admin"."search_audit_log"(term text) returns setof "admin"."audit_log" as $$
  select * from admin.audit_log
  where old_data::text ilike '%' || term || '%'
     or new_data::text ilike '%' || term || '%';
$$ language sql stable;

grant execute on function "admin"."search_audit_log"(text) to service_role;
grant all on all tables in schema "admin" to service_role;
alter default privileges in schema "admin" grant all on tables to service_role;

-- Backfill: attach the trigger to any table that already existed before
-- this migration ran (the event trigger above only catches future
-- CREATE TABLEs) - a no-op on a genuinely fresh database. Excludes the
-- portal_* tables by name too, in case this runs before they've been
-- moved to `admin` (see two-factor-store.ts / registration-store.ts).
do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
      and tablename <> 'audit_log'
      and tablename not like 'portal\_%'
  loop
    execute format('drop trigger if exists audit_trg on public.%I', t.tablename);
    execute format('create trigger audit_trg after insert or update or delete on public.%I for each row execute function admin.audit_trigger_fn()', t.tablename);
  end loop;
end $$;

notify pgrst, 'reload schema';
