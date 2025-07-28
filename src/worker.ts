import { Processors } from "./constants";
import { pay } from "./processor";
import { RedisInstance, getRedis, popPaymentJob, REDIS_PAYMENTS_QUEUE, REDIS_PAID_DEFAULT_CHANNEL, REDIS_PAID_FALLBACK_CHANNEL } from "./redis";

export const startWorker = async (pubRedis: RedisInstance, listenRedis: RedisInstance, processors: Processors) => {
  while (true) {
    const correlationId = await popPaymentJob(listenRedis);

    if (!correlationId) {
      continue;
    };

    const result = await pay({
      correlationId,
      amount: 19.90
    }, 20, processors);

    if (result.ok) {
      const channel = result.usedProcessor === "default"
        ? REDIS_PAID_DEFAULT_CHANNEL
        : REDIS_PAID_FALLBACK_CHANNEL;

      await pubRedis.publish(channel, String(result.requestedAtTime));
    } else {
      await pubRedis.lpush(REDIS_PAYMENTS_QUEUE, correlationId);
    }
  }
}