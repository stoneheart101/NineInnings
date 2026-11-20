-- Coach names no longer require an authenticator. The site does not enroll one.
drop policy if exists profiles_update_aal on public.profiles;

revoke all on function private.caller_meets_aal() from public, anon, authenticated;
drop function private.caller_meets_aal();

revoke usage on schema private from authenticated;
