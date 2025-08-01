import { get } from "http";
import { JSONCONTENT_TYPE, Processors, ProcessorState } from "./constants";
import { getRedis, RedisInstance } from "./redis";

export type Processor = 'default' | 'fallback';

type Payment = {
    correlationId: string;
    amount: number;
}

export const checkHealth = async (processor: ProcessorState, pubRedis: RedisInstance) => fetch(processor.healthcheckUrl, {
    method: 'GET',
    headers: JSONCONTENT_TYPE
}).then(async result => result.ok && result.json().then(async body => {
    const { failing, minResponseTime } = body as {
        failing: boolean;
        minResponseTime: number;
    };
    pubRedis.publish(
        processor.healthChannel,
        `${Number(failing)}:${minResponseTime}`,
    );

    processor.failing = failing;
    processor.minResponseTime = minResponseTime;
}));

export const subscribeToRedisHealth = async (processor: ProcessorState) => {
    const subRedis = await getRedis();

    subRedis.subscribe(processor.healthChannel, () => {
        console.log(`Subscribed to ${processor.healthChannel}`);
    });

    subRedis.on("message", (channel, message) => {
        if (channel !== processor.healthChannel) {
            return;
        }

        const [failing, minResponseTime] = message.split(':');

        processor.failing = failing === '1';
        processor.minResponseTime = Number(minResponseTime);
    });
}

export const decideProcessor = (attempt = 0, attempts = 10, processors: Processors) => {
    if (attempt >= attempts - 1) {
        return processors.fallback;
    }

    if (processors.default.failing && processors.fallback.failing) {
        return processors.default;
    }

    if (processors.default.minResponseTime <= processors.fallback.minResponseTime) {
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
    }).then(({ ok }) => ({
        ok,
        usedProcessor: usedProcessor.processor,
        requestedAtTime,
    }));
};

export const pay = async (payment: Payment, attempts = 10, processors: Processors, requestedAtISO: string, requestedAtTime: number) => {
    for (let i = 0; i <= attempts; i++) {
        const result = await tryToPay(payment, i, attempts, requestedAtISO, requestedAtTime, processors);

        if (result.ok || i >= attempts) {
            return result;
        };

        await new Promise(resolve => setTimeout(resolve, (i + 1) * 50));
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    return tryToPay(payment, attempts, attempts, requestedAtISO, requestedAtTime, processors);
};
