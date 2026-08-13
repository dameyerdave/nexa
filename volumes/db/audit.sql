-- PostgREST pre-request hook: copies the X-User-Email header (attached by
-- the portal's Studio identity proxy - see portal/server/utils/studio-proxy.ts -
-- or by the portal's own writes) into a session-local GUC, so the audit
-- trigger below can read who's actually behind a write regardless of
-- which shared Postgres role/connection actually executes it.
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

-- Generic row-change audit log for every table in `public`, except the
-- portal's own internal bookkeeping (portal_* - registrations, 2FA - not
-- user data) and audit_log itself.
create table if not exists "public"."audit_log" (
  id bigint generated always as identity primary key,
  table_name text not null,
  operation text not null,
  old_data jsonb,
  new_data jsonb,
  changed_by text not null default 'unknown',
  changed_at timestamptz not null default now()
);

create or replace function "public"."audit_trigger_fn"() returns trigger as $$
declare
  actor text;
begin
  actor := coalesce(nullif(current_setting('app.current_user_email', true), ''), 'unknown');
  if (tg_op = 'INSERT') then
    insert into public.audit_log(table_name, operation, new_data, changed_by)
    values (tg_table_name, tg_op, to_jsonb(new), actor);
    return new;
  elsif (tg_op = 'UPDATE') then
    insert into public.audit_log(table_name, operation, old_data, new_data, changed_by)
    values (tg_table_name, tg_op, to_jsonb(old), to_jsonb(new), actor);
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.audit_log(table_name, operation, old_data, changed_by)
    values (tg_table_name, tg_op, to_jsonb(old), actor);
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer set search_path = public;

-- Auto-attaches the audit trigger to every new table created in `public` -
-- whether via Import Excel or directly in Studio's Table Editor - so
-- nothing has to remember to wire this up per table.
create or replace function "public"."attach_audit_trigger"() returns event_trigger as $$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands() where command_tag = 'CREATE TABLE'
  loop
    if obj.schema_name = 'public' and obj.object_identity !~ '^public\.(audit_log|portal_.*)$' then
      execute format(
        'drop trigger if exists audit_trg on %s; create trigger audit_trg after insert or update or delete on %s for each row execute function public.audit_trigger_fn()',
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
create or replace function "public"."search_audit_log"(term text) returns setof "public"."audit_log" as $$
  select * from public.audit_log
  where old_data::text ilike '%' || term || '%'
     or new_data::text ilike '%' || term || '%';
$$ language sql stable;

grant execute on function "public"."search_audit_log"(text) to service_role;

-- Backfill: attach the trigger to any table that already existed before
-- this migration ran (the event trigger above only catches future
-- CREATE TABLEs) - a no-op on a genuinely fresh database.
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
    execute format('create trigger audit_trg after insert or update or delete on public.%I for each row execute function public.audit_trigger_fn()', t.tablename);
  end loop;
end $$;

notify pgrst, 'reload schema';
