import { Processors } from "./constants";
import { pay } from "./processor";
import { RedisInstance, getRedis, popPaymentJob, REDIS_PAYMENTS_QUEUE, REDIS_PAID_DEFAULT_CHANNEL, REDIS_PAID_FALLBACK_CHANNEL } from "./redis";

export const startWorker = async (pubRedis: RedisInstance, processors: Processors) => {
  const listenRedis = await getRedis();

  while (true) {
    const correlationId = await popPaymentJob(listenRedis);

    if (!correlationId) {
      continue;
    };

    const requestedAt = new Date();
    const requestedAtISO = requestedAt.toISOString();
    const requestedAtTime = requestedAt.getTime();

    const { ok, usedProcessor } = await pay({
      correlationId,
      amount: 19.90
    }, 20, processors, requestedAtISO, requestedAtTime);

    if (ok) {
      const channel = usedProcessor === 'default'
        ? REDIS_PAID_DEFAULT_CHANNEL
        : REDIS_PAID_FALLBACK_CHANNEL;

      pubRedis.publish(channel, String(requestedAtTime));
    } else {
      pubRedis.lpush(REDIS_PAYMENTS_QUEUE, correlationId);
    }
  }
}