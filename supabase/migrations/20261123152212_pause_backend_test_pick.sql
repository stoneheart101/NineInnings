-- Pause the backend test pick. The job, procedure, and history stay.

do $pause$
declare
  id bigint;
begin
  select jobid into id
  from cron.job
  where jobname = 'backend_test_pick';

  if id is null then
    raise exception 'BACKEND TEST JOB IS MISSING';
  end if;

  perform cron.alter_job(job_id := id, active := false);
end;
$pause$;
