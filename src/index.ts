import { getLength, insertPayment } from "./bSearch";
import { JSONCONTENT_TYPE, PROCESSOR_DEFAULT_HEALTH_URL, PROCESSOR_DEFAULT_PAYMENT_URL, PROCESSOR_FALLBACK_HEALTH_URL, PROCESSOR_FALLBACK_PAYMENT_URL, ProcessorState } from "./constants";
import { checkHealth, subscribeToRedisHealth } from "./processor";
import {
    getRedis,
    REDIS_PAID_DEFAULT_CHANNEL,
    REDIS_PAID_FALLBACK_CHANNEL,
    REDIS_PAYMENTS_QUEUE
} from "./redis";
import { startWorker } from "./worker";

const send = (status: number, data: any): Response =>
    new Response(JSON.stringify(data), {
        status: status,
        headers: JSONCONTENT_TYPE,
    });

const target = new TextEncoder().encode('"correlationId":"');
const decoder = new TextDecoder();

const extractCorrelationIdFromBuffer = (buf: Uint8Array): string => {
    outer: for (let i = 0; i <= buf.length - target.length; i++) {
        for (let j = 0; j < target.length; j++) {
            if (buf[i + j] !== target[j]) continue outer;
        }

        const from = i + target.length;
        const to = buf.indexOf(0x22, from);
        return decoder.decode(buf.subarray(from, to));
    }

    return "0";
}

const ACCEPTED = { status: 200 };

(async () => {
    const [subRedis, pubRedis] = await Promise.all([
        getRedis(),
        getRedis()
    ]);
    const processors = {
        default: {
            failing: false,
            minResponseTime: 0,
            paymentUrl: PROCESSOR_DEFAULT_PAYMENT_URL,
            healthcheckUrl: PROCESSOR_DEFAULT_HEALTH_URL,
            processor: 'default',
            healthChannel: 'payments:default:health',
            summary: []
        } as ProcessorState,
        fallback: {
            failing: false,
            minResponseTime: 0,
            paymentUrl: PROCESSOR_FALLBACK_PAYMENT_URL,
            healthcheckUrl: PROCESSOR_FALLBACK_HEALTH_URL,
            processor: 'fallback',
            healthChannel: 'payments:fallback:health',
            summary: []
        } as ProcessorState
    };

    subscribeToRedisHealth(processors.default, subRedis);
    setInterval(() => checkHealth(processors.default, pubRedis), 5000);
    checkHealth(processors.default, pubRedis);
    subRedis.subscribe(REDIS_PAID_DEFAULT_CHANNEL, payResult => {
        const time = Number(payResult);
        insertPayment(time, processors.default.summary);

        return true;
    });

    subscribeToRedisHealth(processors.fallback, subRedis);
    setInterval(() => checkHealth(processors.fallback, pubRedis), 5000);
    checkHealth(processors.fallback, pubRedis);
    subRedis.subscribe(REDIS_PAID_FALLBACK_CHANNEL, payResult => {
        const time = Number(payResult);
        insertPayment(time, processors.fallback.summary);

        return true;
    });

    for (let i = 0; i < 10; i++) {
        startWorker(pubRedis, processors);
    }

    const payments: string[] = [];

    (async () => {
        while (true) {
            let ids = payments.splice(0, 1000);

            if (!ids.length) {
                await new Promise(resolve => setTimeout(resolve, 250));
                ids = payments.splice(0, 1000);

                if (!ids.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }
            }

            await pubRedis.lPush(REDIS_PAYMENTS_QUEUE, ids);
        }
    })();

    setTimeout(() => Bun.serve({
        port: 3000,
        async fetch(req) {
            const { method, url } = req;

            if (method === "GET" && url.includes("/payments-summary")) {
                const parsed = new URL(url);

                const from = parsed.searchParams.get("from") || undefined;
                const to = parsed.searchParams.get("to") || undefined;

                const fromScore = from ? new Date(from).getTime() : undefined;
                const toScore = to ? new Date(to).getTime() : undefined;

                const defaultLength = Number(getLength(processors.default.summary, fromScore, toScore));
                const fallbackLength = Number(getLength(processors.fallback.summary, fromScore, toScore));

                return send(200, {
                    default: {
                        totalRequests: defaultLength,
                        totalAmount: Number((defaultLength * 19.90).toFixed(2)),
                    },
                    fallback: {
                        totalRequests: fallbackLength,
                        totalAmount: Number((fallbackLength * 19.90).toFixed(2)),
                    }
                });
            }

            if (method === "POST" && url === "/admin/purge-payments") {
                processors.default.summary = [];
                processors.fallback.summary = [];

                return send(200, {
                    message: "All payments purged."
                });
            }

            if (method === "POST" && url.includes("/payments")) {
                const bodyBuffer = await req.arrayBuffer();
                const id = extractCorrelationIdFromBuffer(new Uint8Array(bodyBuffer));
                payments.push(id);
                return new Response(null, ACCEPTED);
            }

            return send(404, { error: "Not Found" });
        }
    }), 500);
})();
