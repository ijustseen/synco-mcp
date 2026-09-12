import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("mark stale agents offline", { minutes: 1 }, internal.coordination.markAllStaleOffline);

export default crons;
