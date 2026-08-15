/** Self-healing counterpart to volumes/db/audit.sql: that file only runs
 * on a brand-new `volumes/db/data` (Postgres only executes
 * docker-entrypoint-initdb.d scripts once, on first init), so an
 * already-running deployment picking up this feature needs the same DDL
 * applied here instead - same idempotent SQL, called once per portal
 * process (see server/plugins/bootstrap-audit.ts). Keep this in sync with
 * volumes/db/audit.sql if either changes. */

let ensured = false;

export async function ensureAuditInfrastructure(): Promise<void> {
  if (ensured) return;
  await pgMetaQuery(`
    create schema if not exists "admin";
    grant usage on schema "admin" to service_role;

    -- Migrates real data from a pre-"admin"-schema deployment - a plain
    -- "create table if not exists" below wouldn't touch this, it'd just
    -- leave the old, still-populated public.audit_log orphaned and start
    -- a second, empty admin.audit_log from scratch. No-op on a deployment
    -- that never had public.audit_log (fresh installs, or one that's
    -- already migrated).
    do $$
    begin
      if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'audit_log')
         and not exists (select 1 from pg_tables where schemaname = 'admin' and tablename = 'audit_log') then
        alter table public.audit_log set schema admin;
      end if;
    end $$;

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

    create or replace function "admin"."search_audit_log"(term text) returns setof "admin"."audit_log" as $$
      select * from admin.audit_log
      where old_data::text ilike '%' || term || '%'
         or new_data::text ilike '%' || term || '%';
    $$ language sql stable;

    grant execute on function "admin"."search_audit_log"(text) to service_role;
    grant all on all tables in schema "admin" to service_role;
    alter default privileges in schema "admin" grant all on tables to service_role;

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
  `);
  ensured = true;
}
