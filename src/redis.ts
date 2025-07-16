import { createClient } from "redis";
import { setDefaultHealthConstant } from "./processor/default";
import { setFallbackHealthConstant } from "./processor/fallback";

let redisClient: ReturnType<typeof createClient> | undefined;

export const getRedis = async () => {
    if (!redisClient) {
        redisClient = await createClient({
            url: process.env.REDIS_URL || "redis://localhost:6379",
        }).connect();
    }

    return redisClient as ReturnType<typeof createClient>;
};

// queue
const REDIS_PAYMENTS_QUEUE = "payments:queue";

export const popPaymentJob = async () => {
    const job = await (await getRedis()).rPop(REDIS_PAYMENTS_QUEUE);

    if (!job) {
        return;
    }

    const [correlationId, amount] = job.split(":");

    return {
        correlationId,
        amount: parseFloat(amount),
        job,
    };
};

export const pushStringPaymentJob = async (job: string) =>
    (await getRedis()).lPush(REDIS_PAYMENTS_QUEUE, job);

export const pushPaymentJob = async (
    correlationId: string,
    amount: number,
) => (await getRedis()).lPush(
    REDIS_PAYMENTS_QUEUE,
    `${correlationId}:${amount}`,
);

// health cache
export const setDefaultPaymentProcessorHealth = async (item: {
    failing: boolean;
    minResponseTime: number;
    PX?: number;
}) => {
    setDefaultHealthConstant({
        failing: item.failing,
        minResponseTime: item.minResponseTime,
    });

    await (await getRedis()).set(
        "payment:default:health",
        `${Number(item.failing)}:${item.minResponseTime}`,
        {
            PX: item?.PX || 5000, // Set expiration time to 5 seconds
        },
    );

    await (await getRedis()).publish(
        "payment:default:health",
        `${Number(item.failing)}:${item.minResponseTime}`,
    );
};

export const getDefaultPaymentProcessorHealth = async () => {
    const cached = await (await getRedis()).get("payment:default:health");

    if (!cached) {
        return;
    }

    const [failing, minResponseTime] = cached.split(":").map(Number);

    return {
        failing: Boolean(failing),
        minResponseTime,
    };
};

export const setFallbackPaymentProcessorHealth = async (item: {
    failing: boolean;
    minResponseTime: number;
    PX?: number;
}) => {
    setFallbackHealthConstant({
        failing: item.failing,
        minResponseTime: item.minResponseTime,
    });

    await (await getRedis()).set(
        "payment:fallback:health",
        `${Number(item.failing)}:${item.minResponseTime}`,
        {
            PX: item?.PX || 5000, // Set expiration time to 5 seconds
        },
    );

    (await (getRedis())).publish(
        "health:update:default",
        `${Number(item.failing)}:${item.minResponseTime}`,
    );
};

export const getFallbackPaymentProcessorHealth = async () => {
    const cached = await (await getRedis()).get("payment:fallback:health");

    if (!cached) {
        return;
    }

    const [failing, minResponseTime] = cached.split(":").map(Number);

    return {
        failing: Boolean(failing),
        minResponseTime,
    };
};

export async function insertPaymentToRedis(
    processor: "default" | "fallback",
    requestedAt: Date,
    correlationId: string,
    amount: number,
): Promise<void> {
    const key = `payments:${processor}`;
    const score = requestedAt.getTime() / 1000;

    const member = JSON.stringify({ correlationId, amount });

    await (await getRedis()).zAdd(key, [{ score, value: member }]);
}

export async function getProcessorSummaryFromRedis(
    processor: "default" | "fallback",
    from?: Date,
    to?: Date,
): Promise<{ totalRequests: number; totalAmount: number }> {
    const key = `payments:${processor}`;

    const min = from ? (from.getTime() / 1000).toString() : "-inf";
    const max = to ? (to.getTime() / 1000).toString() : "+inf";

    const members = await (await getRedis()).zRangeByScore(key, min, max);

    let totalRequests = 0;
    let totalAmount = 0;

    for (const member of members) {
        const parsed = JSON.parse(member);
        totalRequests += 1;
        totalAmount += parseFloat(parsed.amount);
    }

    return { totalRequests, totalAmount };
}

export async function getPaymentsSummaryFromRedis(
    from?: Date,
    to?: Date,
) {
    const [defaultSummary, fallbackSummary] = await Promise.all([
        getProcessorSummaryFromRedis("default", from, to),
        getProcessorSummaryFromRedis("fallback", from, to),
    ]);

    return {
        default: defaultSummary,
        fallback: fallbackSummary,
    };
}
