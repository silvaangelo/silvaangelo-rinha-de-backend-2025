export const PROCESSOR_DEFAULT_URL = process.env.PROCESSOR_DEFAULT_URL ||
    "http://payment-processor-default:8080";
export const PROCESSOR_FALLBACK_URL = process.env.PROCESSOR_FALLBACK_URL ||
    "http://payment-processor-fallback:8080";

export const PROCESSOR_FALLBACK_PAYMENT_URL =
    `${PROCESSOR_FALLBACK_URL}/payments`;
export const PROCESSOR_DEFAULT_PAYMENT_URL =
    `${PROCESSOR_DEFAULT_URL}/payments`;

export const PROCESSOR_DEFAULT_HEALTH_URL =
    `${PROCESSOR_DEFAULT_URL}/payments/service-health`;
export const PROCESSOR_FALLBACK_HEALTH_URL =
    `${PROCESSOR_FALLBACK_URL}/payments/service-health`;
