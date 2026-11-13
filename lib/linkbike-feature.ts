export function linkBikeEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (env.VERCEL_ENV === "production" && env.VERCEL_TARGET_ENV === "production") {
    return env.NODE_ENV === "production" && env.LINKBIKE_ENABLE_PRODUCTION === "true";
  }

  if (env.LINKBIKE_ENABLE_NON_PRODUCTION !== "true") return false;
  const preview = env.VERCEL_ENV === "preview" && env.VERCEL_TARGET_ENV === "preview";
  const local = env.NODE_ENV === "development" &&
    env.VERCEL === undefined && env.VERCEL_ENV === undefined && env.VERCEL_TARGET_ENV === undefined;
  return preview || local;
}
