import { createClient } from "redis";
import { paymentProcessors, PaymentProcessorState } from "./processor";
import { countInRange } from "./bSearch";

export const getRedis = () => createClient({
    url: process.env.REDIS_URL || "redis://localhost:6379",
}).connect();

export type RedisInstance = Awaited<ReturnType<typeof createClient>>;

export const REDIS_PAYMENTS_QUEUE = "payments:queue";

export const popPaymentJob = async (
    redis: RedisInstance
) => {
    const job = await redis.brPop(REDIS_PAYMENTS_QUEUE, 0);

    if (!job) {
        return;
    }

    return job.element;
};

export const getLength = (
    processor: PaymentProcessorState,
    fromScore?: number,
    toScore?: number
) => {
    if (!fromScore || !toScore) {
        return processor.summary.length;
    }

    return countInRange(fromScore, toScore, processor.summary);
}

export const getSummary = (
    fromScore?: number,
    toScore?: number
) => {
    const defaultLength = getLength(paymentProcessors.default, fromScore, toScore)
    const fallbackLength = getLength(paymentProcessors.fallback, fromScore, toScore)

    return {
        default: {
            totalRequests: defaultLength,
            totalAmount: defaultLength * 19.90
        },
        fallback: {
            totalRequests: fallbackLength,
            totalAmount: fallbackLength * 19.90
        }
    }
}
