import { JSONCONTENT_TYPE } from ".";
import { PROCESSOR_DEFAULT_HEALTH_URL, PROCESSOR_DEFAULT_PAYMENT_URL, PROCESSOR_FALLBACK_HEALTH_URL, PROCESSOR_FALLBACK_PAYMENT_URL } from "./env";
import { RedisInstance } from "./redis";

export type PaymentProcessorState = {
    failing: boolean;
    minResponseTime: number;
    paymentUrl: string;
    healthcheckUrl: string;
    processor: 'default' | 'fallback';
    paidChannel: string;
    healthChannel: string;
    summary: number[];
};

export const paymentProcessors = {
    default: {
        failing: false,
        minResponseTime: 350,
        paymentUrl: PROCESSOR_DEFAULT_PAYMENT_URL,
        healthcheckUrl: PROCESSOR_DEFAULT_HEALTH_URL,
        processor: 'default',
        paidChannel: 'payments:default:index',
        healthChannel: 'payments:default:health',
        summary: []
    } as PaymentProcessorState,
    fallback: {
        failing: false,
        minResponseTime: 350,
        paymentUrl: PROCESSOR_FALLBACK_PAYMENT_URL,
        healthcheckUrl: PROCESSOR_FALLBACK_HEALTH_URL,
        processor: 'fallback',
        paidChannel: 'payments:fallback:index',
        healthChannel: 'payments:fallback:health',
        summary: []
    } as PaymentProcessorState
};

export type PaymentProcessorAlternatives = keyof typeof paymentProcessors;

export type Payment = {
    correlationId: string;
    amount: number;
}

export const buildPaymentProcessor = async (pubRedis: RedisInstance, subRedis: RedisInstance) => {
    const checkHealth = async (processor: PaymentProcessorState) => fetch(processor.healthcheckUrl, {
        method: 'GET',
        headers: JSONCONTENT_TYPE
    }).then(async result => result.ok && result.json().then(async ({
        failing,
        minResponseTime
    }: {
        failing: boolean;
        minResponseTime: number;
    }) => {
        const value = `${Number(failing)}:${minResponseTime}`;

        pubRedis.publish(
            processor.healthChannel,
            value,
        );

        processor.failing = failing;
        processor.minResponseTime = minResponseTime;
    }))

    const subscribeToRedisHealth = (processor: PaymentProcessorState) => subRedis.subscribe(processor.healthChannel, (message: string) => {
        const [failing, minResponseTime] = message.split(':').map(Number);

        processor.failing = Boolean(failing);
        processor.minResponseTime = minResponseTime;
    });

    checkHealth(paymentProcessors.default);
    checkHealth(paymentProcessors.fallback);
    subscribeToRedisHealth(paymentProcessors.default);
    subscribeToRedisHealth(paymentProcessors.fallback);

    setInterval(() => checkHealth(paymentProcessors.default), 5000);
    setInterval(() => checkHealth(paymentProcessors.fallback), 5000);

    const decideProcessor = (attempt = 0) => {
        if (paymentProcessors.default.failing && paymentProcessors.fallback.failing) {
            return paymentProcessors.default;
        }

        if (paymentProcessors.default.minResponseTime <= paymentProcessors.fallback.minResponseTime) {
            return paymentProcessors.default;
        }

        if (attempt < 25) {
            return paymentProcessors.default;
        }

        return paymentProcessors.fallback;
    }

    const pay = async (payment: Payment, attempt = 0) => {
        const requestedAt = new Date();
        const atTime = requestedAt.getTime();

        const usedProcessor = decideProcessor(attempt);

        const { ok } = await fetch(usedProcessor.paymentUrl, {
            method: "POST",
            headers: JSONCONTENT_TYPE,
            body: JSON.stringify({
                correlationId: payment.correlationId,
                amount: payment.amount,
                requestedAt: requestedAt.toISOString(),
            }),
        });

        return {
            ok,
            usedProcessor,
            requestedAt: atTime
        };
    };

    return {
        pay: async (payment: Payment) => {
            for (let i = 0; i <= 30; i++) {
                const result = await pay(payment, i);

                if (result.ok || i >= 30) {
                    return result;
                };
            }

            return pay(payment, 0);
        },
        checkHealth
    }
}

export type PaymentProcessor = Awaited<ReturnType<typeof buildPaymentProcessor>>;