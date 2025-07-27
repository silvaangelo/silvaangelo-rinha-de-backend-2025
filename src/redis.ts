import { createClient } from "redis";

export const getRedis = () => createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
}).connect();

export type RedisInstance = Awaited<ReturnType<typeof createClient>>;

export const REDIS_PAYMENTS_QUEUE = "payments:queue";
export const REDIS_PAID_DEFAULT_CHANNEL = "payments:paid:channel";
export const REDIS_PAID_FALLBACK_CHANNEL = "payments:paid:fallback:channel";

export const popPaymentJob = async (
    redis: RedisInstance
) => {
    const job = await redis.brPop(REDIS_PAYMENTS_QUEUE, 10000);

    if (!job || !job?.element) {
        return;
    }

    return job?.element;
};
