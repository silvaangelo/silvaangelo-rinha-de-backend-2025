import { PaymentProcessor } from "./processor";
import { RedisInstance, getRedis, popPaymentJob, REDIS_PAYMENTS_QUEUE } from "./redis";

export const startWorker = async (processor: PaymentProcessor, pubRedis: RedisInstance) => {
  const listenRedis = await getRedis();

  while (true) {
    const job = await popPaymentJob(listenRedis);

    if (!job) {
      continue;
    };

    const result = await processor.pay({
      correlationId: job,
      amount: 19.90
    });

    if (result.ok) {
      pubRedis.publish(result.usedProcessor.paidChannel, String(result.requestedAt));
    } else {
      pubRedis.rPush(REDIS_PAYMENTS_QUEUE, job);
    }
  }
}