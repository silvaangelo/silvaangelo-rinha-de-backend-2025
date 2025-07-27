import { JSONCONTENT_TYPE, Processors, ProcessorState } from "./constants";
import { RedisInstance } from "./redis";

export type Processor = 'default' | 'fallback';

type Payment = {
    correlationId: string;
    amount: number;
}

export const checkHealth = async (processor: ProcessorState, pubRedis: RedisInstance) => fetch(processor.healthcheckUrl, {
    method: 'GET',
    headers: JSONCONTENT_TYPE
}).then(async result => result.ok && result.json().then(async ({
    failing,
    minResponseTime
}: {
    failing: boolean;
    minResponseTime: number;
}) => {
    pubRedis.publish(
        processor.healthChannel,
        `${Number(failing)}:${minResponseTime}`,
    );

    processor.failing = failing;
    processor.minResponseTime = minResponseTime;
}));

export const subscribeToRedisHealth = (processor: ProcessorState, subRedis: RedisInstance) => subRedis.subscribe(processor.healthChannel, (message: string) => {
    const [failing, minResponseTime] = message.split(':');

    processor.failing = failing === '1';
    processor.minResponseTime = Number(minResponseTime);
});

export const decideProcessor = (attempt = 0, attempts = 30, processors: Processors) => {
    if (processors.default.failing && processors.fallback.failing) {
        return processors.default;
    }

    if (processors.default.minResponseTime <= processors.fallback.minResponseTime) {
        return processors.default;
    }

    if (attempt < attempts - 1) {
        return processors.default;
    }

    return processors.fallback;
}

export const tryToPay = async (payment: Payment, attempt = 0, attempts = 0, requestedAtISO: string, requestedAtTime: number, processors: Processors) => {
    const usedProcessor = decideProcessor(attempt, attempts, processors);

    return fetch(usedProcessor.paymentUrl, {
        method: "POST",
        headers: JSONCONTENT_TYPE,
        body: JSON.stringify({
            correlationId: payment.correlationId,
            amount: payment.amount,
            requestedAt: requestedAtISO,
        }),
    }).then(result => {
        const { ok } = result;

        return {
            ok,
            usedProcessor: usedProcessor.processor,
            requestedAtTime,
        };
    });
};

export const pay = async (payment: Payment, attempts = 20, processors: Processors) => {
    const requestedAt = new Date();
    const requestedAtISO = requestedAt.toISOString();
    const requestedAtTime = requestedAt.getTime();

    for (let i = 0; i <= attempts; i++) {
        const result = await tryToPay(payment, i, attempts, requestedAtISO, requestedAtTime, processors);

        if (result.ok || i >= attempts) {
            return result;
        };

        await new Promise(resolve => setTimeout(resolve, 200));
    }

    return tryToPay(payment, attempts, attempts, requestedAtISO, requestedAtTime, processors);
};
