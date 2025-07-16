import {
    activateDefaultHealthCheck,
    DEFAULT_HEALTH,
    processPaymentDefault,
} from "./processor/default";
import {
    activateFallbackHealthCheck,
    FALLBACK_HEALTH,
    processPaymentFallback,
} from "./processor/fallback";
import {
    setDefaultPaymentProcessorHealth,
    setFallbackPaymentProcessorHealth,
} from "./redis";

export const payment = async (
    correlationId: string,
    amount: number,
    requestedAt: Date,
): Promise<{
    result: boolean;
    requestedAt: Date;
    processor: "default" | "fallback";
}> => {
    await Promise.all([
        activateDefaultHealthCheck(),
        activateFallbackHealthCheck(),
    ]);

    const defaultIsActive = DEFAULT_HEALTH &&
        !DEFAULT_HEALTH.failing;

    const fallbackResponseTime = (FALLBACK_HEALTH?.minResponseTime || 0) + 50;

    if (
        defaultIsActive &&
            (DEFAULT_HEALTH &&
                DEFAULT_HEALTH?.minResponseTime < fallbackResponseTime) ||
        !DEFAULT_HEALTH
    ) {
        const resultDefault = await processPaymentDefault(
            correlationId,
            amount,
            requestedAt,
        );

        if (
            !DEFAULT_HEALTH ||
            (DEFAULT_HEALTH && (DEFAULT_HEALTH.failing != !resultDefault))
        ) {
            await setDefaultPaymentProcessorHealth({
                failing: !resultDefault,
                minResponseTime: DEFAULT_HEALTH?.minResponseTime || 100,
                PX: 100,
            });
        }

        if ((!resultDefault && FALLBACK_HEALTH?.failing) || resultDefault) {
            return {
                result: resultDefault,
                requestedAt,
                processor: "default",
            };
        }
    }

    const resultFallback = await processPaymentFallback(
        correlationId,
        amount,
        requestedAt,
    );

    if (
        !FALLBACK_HEALTH ||
        (FALLBACK_HEALTH && (FALLBACK_HEALTH.failing != !resultFallback))
    ) {
        await setFallbackPaymentProcessorHealth({
            failing: !resultFallback,
            minResponseTime: FALLBACK_HEALTH?.minResponseTime || 50,
            PX: 100,
        });
    }

    return {
        result: resultFallback,
        requestedAt,
        processor: "fallback",
    };
};
