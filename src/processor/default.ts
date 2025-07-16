import {
    PROCESSOR_DEFAULT_HEALTH_URL,
    PROCESSOR_DEFAULT_PAYMENT_URL,
    PROCESSOR_DEFAULT_URL,
} from "../env";
import { getRedis, setDefaultPaymentProcessorHealth } from "../redis";

export let DEFAULT_HEALTH: {
    failing: boolean;
    minResponseTime: number;
} | undefined;

export const setDefaultHealthConstant = (item: {
    failing: boolean;
    minResponseTime: number;
}) => {
    DEFAULT_HEALTH = {
        failing: item.failing,
        minResponseTime: item.minResponseTime,
    };
};

export const getDefaultHealth = async () => {
    const response = await fetch(
        `${PROCESSOR_DEFAULT_URL}/payments/service-health`,
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
    const response = await fetch(PROCESSOR_DEFAULT_HEALTH_URL, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        return;
    }

    const data = await response.json() as {
        failing: boolean;
        minResponseTime: number;
    };

    await setDefaultPaymentProcessorHealth({
        failing: data.failing,
        minResponseTime: data.minResponseTime,
        PX: 5000,
    });
};

let shouldCheckDefaultHealth = false;

export const activateDefaultHealthCheck = async () => {
    if (!shouldCheckDefaultHealth) {
        shouldCheckDefaultHealth = true;
        await checkDefaultHealth();
    }
};

export const setIntervalDefaultHealthFromRedis = async () => {
    (await getRedis()).subscribe(
        "payment:default:health",
        async (message) => {
            const [failing, minResponseTime] = message.split(":").map(Number);

            DEFAULT_HEALTH = {
                failing: Boolean(failing),
                minResponseTime,
            };
        },
    );
};

export const setIntervalDefaultHealth = async () => {
    setInterval(async () => {
        if (shouldCheckDefaultHealth) {
            await checkDefaultHealth();
        }
    }, 2500);
};

export const processPaymentDefault = async (
    correlationId: string,
    amount: number,
    requestedAt: Date,
) => {
    const response = await fetch(PROCESSOR_DEFAULT_PAYMENT_URL, {
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
