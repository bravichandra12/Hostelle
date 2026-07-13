import { createClient } from "redis";

const redis = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  socket: {
    reconnectStrategy: () => false,
  },
});

let redisUnavailable = false;
let connectPromise = null;
const fallbackStore = new Map();

redis.on("error", () => {
  redisUnavailable = true;
});

const ensureConnected = async () => {
  if (redisUnavailable) {
    return false;
  }

  if (!connectPromise) {
    connectPromise = redis.connect().catch(() => {
      redisUnavailable = true;
      return null;
    });
  }

  await connectPromise;
  return !redisUnavailable && redis.isOpen;
};

const isExpired = (entry) => entry.expiresAt !== null && entry.expiresAt <= Date.now();

const fallbackGet = (key) => {
  const entry = fallbackStore.get(key);
  if (!entry) {
    return null;
  }

  if (isExpired(entry)) {
    fallbackStore.delete(key);
    return null;
  }

  return entry.value;
};

const fallbackSetEx = (key, ttlSeconds, value) => {
  const expiresAt = Number(ttlSeconds) > 0 ? Date.now() + Number(ttlSeconds) * 1000 : null;
  fallbackStore.set(key, { value, expiresAt });
  return "OK";
};

const fallbackDel = (key) => fallbackStore.delete(key) ? 1 : 0;

const safeCall = async (method, ...args) => {
  try {
    const connected = await ensureConnected();

    if (!connected) {
      if (method === "get") return fallbackGet(args[0]);
      if (method === "setEx") return fallbackSetEx(args[0], args[1], args[2]);
      if (method === "del") return fallbackDel(args[0]);
      return null;
    }

    return await redis[method](...args);
  } catch (err) {
    redisUnavailable = true;
    if (method === "get") return fallbackGet(args[0]);
    if (method === "setEx") return fallbackSetEx(args[0], args[1], args[2]);
    if (method === "del") return fallbackDel(args[0]);
    return null;
  }
};

const safeRedis = {
  get: (...args) => safeCall("get", ...args),
  setEx: (...args) => safeCall("setEx", ...args),
  del: (...args) => safeCall("del", ...args),
};

export default safeRedis;