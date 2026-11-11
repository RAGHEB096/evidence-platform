-- Account administration RPCs used by the admin-users Edge Function
-- (ADR-013: service-only, explicit actor).

create function public.svc_set_user_flags(
  p_actor uuid,
  p_user_id uuid,
  p_is_admin boolean,
  p_can_create_protocols boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_admin boolean;
begin
  perform private.require_active_admin(p_actor);
  perform private.set_actor(p_actor);

  select p.is_admin into v_was_admin from public.user_profiles p where p.id = p_user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'P0002', hint = 'user_not_found';
  end if;
  if v_was_admin and not p_is_admin then
    perform private.assert_other_active_admin(p_user_id);
  end if;

  update public.user_profiles
  set is_admin = p_is_admin,
      can_create_protocols = p_can_create_protocols
  where id = p_user_id;
end;
$$;

create function public.svc_set_display_name(p_actor uuid, p_user_id uuid, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_active_admin(p_actor);
  perform private.set_actor(p_actor);

  update public.user_profiles set display_name = btrim(p_display_name) where id = p_user_id;
  if not found then
    raise exception 'User not found.' using errcode = 'P0002', hint = 'user_not_found';
  end if;
end;
$$;

revoke execute on function
  public.svc_set_user_flags(uuid, uuid, boolean, boolean),
  public.svc_set_display_name(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function
  public.svc_set_user_flags(uuid, uuid, boolean, boolean),
  public.svc_set_display_name(uuid, uuid, text)
to service_role;
