import type { FastifyInstance } from "fastify";

type RecordJob = { id: string; project: string; state: string; deleted_at?: string };
type Params = { project: string; id: string };
export type JobRecordQuery = { trash?: string };

export function matchesJobRecord(job: RecordJob, project: string, query: JobRecordQuery) {
  return job.project === project && Boolean(job.deleted_at) === (query.trash === "1");
}

export function jobRecordRoutes<Job extends RecordJob>(
  app: FastifyInstance,
  base: string,
  jobs: ReadonlyMap<string, Job>,
  save: (job: Job) => void,
  isBusy: (job: Job) => boolean = () => false,
) {
  const unfinished = new Set(["queued", "submitting", "running", "processing"]);
  app.delete<{ Params: Params }>(base + "/:id", async (request, reply) => {
    const job = jobs.get(request.params.id);
    if (!job || job.project !== request.params.project) return reply.code(404).send({ message: "任务记录不存在。" });
    if (unfinished.has(job.state) || isBusy(job)) return reply.code(409).send({ message: "任务正在排队或处理，请在结束后删除记录。" });
    if (!job.deleted_at) save({ ...job, deleted_at: new Date().toISOString() });
    return reply.code(204).send();
  });
  app.post<{ Params: Params }>(base + "/:id/restore", async (request, reply) => {
    const job = jobs.get(request.params.id);
    if (!job || job.project !== request.params.project) return reply.code(404).send({ message: "任务记录不存在。" });
    if (job.deleted_at) save({ ...job, deleted_at: undefined });
    return reply.code(204).send();
  });
}
