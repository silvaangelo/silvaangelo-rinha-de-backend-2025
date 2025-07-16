import { PROCESSOR_FALLBACK_PAYMENT_URL, PROCESSOR_FALLBACK_URL } from "../env";
import { getRedis, setFallbackPaymentProcessorHealth } from "../redis";

export let FALLBACK_HEALTH: {
    failing: boolean;
    minResponseTime: number;
} | undefined;

export const setFallbackHealthConstant = (item: {
    failing: boolean;
    minResponseTime: number;
}) => {
    FALLBACK_HEALTH = {
        failing: item.failing,
        minResponseTime: item.minResponseTime,
    };
};

export const getFallbackHealth = async () => {
    const response = await fetch(
        `${PROCESSOR_FALLBACK_URL}/payments/service-health`,
        {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        },
    );

    if (!response.ok) {
        return;
    }

    return await response.json() as {
        failing: boolean;
        minResponseTime: number;
    };
};

export const checkDefaultHealth = async () => {
    const response = await fetch(
        `${PROCESSOR_FALLBACK_URL}/payments/service-health`,
        {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        },
    );

    if (!response.ok) {
        return;
    }

    const data = await response.json() as {
        failing: boolean;
        minResponseTime: number;
    };

    await setFallbackPaymentProcessorHealth({
        failing: data.failing,
        minResponseTime: data.minResponseTime,
        PX: 5000,
    });
};

let shouldCheckFallbackHealth = false;

export const activateFallbackHealthCheck = async () => {
    if (!shouldCheckFallbackHealth) {
        shouldCheckFallbackHealth = true;
        await checkDefaultHealth();
    }
};

export const setIntervalFallbackHealthFromRedis = async () => {
    (await getRedis()).subscribe(
        "payment:fallback:health",
        async (message) => {
            const [failing, minResponseTime] = message.split(":").map(Number);

            FALLBACK_HEALTH = {
                failing: Boolean(failing),
                minResponseTime,
            };
        },
    );
};

export const setIntervalFallbackHealth = async () =>
    setInterval(async () => {
        if (shouldCheckFallbackHealth) {
            await checkDefaultHealth();
        }
    }, 2500);

export const processPaymentFallback = async (
    correlationId: string,
    amount: number,
    requestedAt: Date,
) => {
    const response = await fetch(PROCESSOR_FALLBACK_PAYMENT_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            correlationId,
            amount,
            requestedAt: requestedAt.toISOString(),
        }),
    });

    if (!response.ok) {
        return false;
    }

    return true;
};
