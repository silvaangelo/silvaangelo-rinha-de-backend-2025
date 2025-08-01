import Redis from "ioredis";

export const getRedis = async () => {
    const client = new Redis({
        path: '/var/run/redis/redis.sock',
        lazyConnect: true,
    });

    await client.connect();

    return client;
};

export type RedisInstance = Awaited<ReturnType<typeof getRedis>>;

export const REDIS_PAYMENTS_QUEUE = "payments:queue";

export const popPaymentJob = async (
    redis: RedisInstance
) => {
    const item = await redis.brpop(REDIS_PAYMENTS_QUEUE, 0);

    if (!item) {
        return;
    }

    return item[1];
};
