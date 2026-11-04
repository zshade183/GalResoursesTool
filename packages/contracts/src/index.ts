import { z } from "zod";

export const jobStates = [
  "draft",
  "queued",
  "submitted",
  "running",
  "processing",
  "awaiting_review",
  "failed",
  "cancel_requested",
  "canceled",
  "reconcile_required",
] as const;

export const JobStateSchema = z.enum(jobStates);
export type JobState = z.infer<typeof JobStateSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  version: z.string(),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

