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

const getCorrelationId = (str: string) => {
    const start = str.indexOf('"correlationId":"');
    if (start !== -1) {
        const from = start + 17; // length of '"correlationId":"'
        const to = str.indexOf('"', from);
        const correlationId = str.slice(from, to);
        return correlationId;
    }
}

const ACCEPTED = { status: 200 };

(async () => {
    const [subRedis, workerPubRedis, pubPaymentRedis, defaultPubRedis, fallbackPubRedis] = await Promise.all([
        getRedis(),
        getRedis(),
        getRedis(),
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
    setInterval(() => checkHealth(processors.default, defaultPubRedis), 5000);
    checkHealth(processors.default, defaultPubRedis);
    subRedis.subscribe(REDIS_PAID_DEFAULT_CHANNEL, REDIS_PAID_FALLBACK_CHANNEL, payResult => {
        console.log(`Subscribed to ${REDIS_PAID_DEFAULT_CHANNEL}`);
    });
    subRedis.on("message", (channel, message) => {
        if (channel === REDIS_PAID_DEFAULT_CHANNEL) {
            const time = Number(message);
            insertPayment(time, processors.default.summary);
        }

        if (channel === REDIS_PAID_FALLBACK_CHANNEL) {
            const time = Number(message);
            insertPayment(time, processors.fallback.summary);
        }
    });

    subscribeToRedisHealth(processors.fallback, subRedis);
    setInterval(() => checkHealth(processors.fallback, fallbackPubRedis), 5000);
    checkHealth(processors.fallback, fallbackPubRedis);

    for (let i = 0; i < 30; i++) {
        const listenRedis = await getRedis();
        startWorker(workerPubRedis, listenRedis, processors);
    }

    await new Promise(resolve => setTimeout(resolve, 500));

    Bun.serve({
        routes: {
            '/payments': {
                POST: async (req) => {
                    const text = await req.text();
                    pubPaymentRedis.lpush(REDIS_PAYMENTS_QUEUE, getCorrelationId(text) as string);
                    return new Response(null, ACCEPTED);
                }
            },
            '/payments-summary': {
                GET: async (req) => {
                    const parsed = new URL(req.url);

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
            },
            '/admin/purge-payments': {
                POST: async (req) => {
                    processors.default.summary = [];
                    processors.fallback.summary = [];
                    return send(200, {
                        message: "All payments purged."
                    });
                }
            }
        },
        error(error) {
            return new Response(`Internal Error: ${error.message}`, {
                status: 500,
                headers: {
                    "Content-Type": "text/plain",
                },
            });
        },
        port: 3000,
        fetch(req) {
            return new Response("Not Found", { status: 404 });
        },
    });
    console.log("Server is running on http://localhost:3000");
})();
