import { getLength, insertPayment } from "./bSearch";
import { JSONCONTENT_TYPE, PROCESSOR_DEFAULT_HEALTH_URL, PROCESSOR_DEFAULT_PAYMENT_URL, PROCESSOR_FALLBACK_HEALTH_URL, PROCESSOR_FALLBACK_PAYMENT_URL, ProcessorState, WORKER_INSTANCE } from "./constants";
import { checkHealth, subscribeToRedisHealth } from "./processor";
import {
    getRedis,
    REDIS_PAYMENTS_QUEUE
} from "./redis";
import { startWorker } from "./worker";

const send = (status: number, data: any): Response =>
    new Response(JSON.stringify(data), {
        status: status,
        headers: JSONCONTENT_TYPE,
    });

const getCorrelationIdFromBuffer = (buffer: Uint8Array): string | undefined => {
    const needle = '"correlationId":"';
    const needleLength = needle.length;
    const text = new TextDecoder().decode(buffer); // Avoid if possible; can optimize further
    const start = text.indexOf(needle);

    if (start === -1) return;
    const from = start + needleLength;
    const to = text.indexOf('"', from);
    if (to === -1) return;
    return text.slice(from, to);
};

(async () => {
    const processors = {
        default: {
            failing: false,
            minResponseTime: 0,
            paymentUrl: PROCESSOR_DEFAULT_PAYMENT_URL,
            healthcheckUrl: PROCESSOR_DEFAULT_HEALTH_URL,
            processor: 'default',
            healthChannel: 'payments:default:health',
            paidChannel: 'paid:default',
            summary: []
        } as ProcessorState,
        fallback: {
            failing: false,
            minResponseTime: 0,
            paymentUrl: PROCESSOR_FALLBACK_PAYMENT_URL,
            healthcheckUrl: PROCESSOR_FALLBACK_HEALTH_URL,
            processor: 'fallback',
            paidChannel: 'paid:fallback',
            healthChannel: 'payments:fallback:health',
            summary: []
        } as ProcessorState
    };

    await Promise.all([
        subscribeToRedisHealth(processors.default),
        subscribeToRedisHealth(processors.fallback),
    ]);

    const subscribeToPaidRedis = await getRedis();

    subscribeToPaidRedis.subscribe(processors.default.paidChannel, processors.fallback.paidChannel, _ => {
        console.log(`Subscribed to paid channels`);
    });
    subscribeToPaidRedis.on("message", (channel, message) => {
        const isDefault = channel === processors.default.paidChannel;

        insertPayment(Number(message), isDefault ? processors.default.summary : processors.fallback.summary);
    });

    if (WORKER_INSTANCE) {
        const [defaultPubRedis, fallbackPubRedis] = await Promise.all([
            getRedis(),
            getRedis()
        ]);

        setInterval(() => checkHealth(processors.default, defaultPubRedis), 5000);
        setInterval(() => checkHealth(processors.fallback, fallbackPubRedis), 5000);

        checkHealth(processors.default, defaultPubRedis);
        checkHealth(processors.fallback, fallbackPubRedis);

        const workerPubRedis = await getRedis();

        for (let i = 0; i < 50; i++) {
            startWorker(workerPubRedis, processors);
        }

        await workerPubRedis.publish('workers:ready', 'ready');
    } else {
        const payments: ArrayBuffer[] = [];

        const pubPaymentRedis = await getRedis();

        (async () => {
            while (true) {
                const toPush = payments.splice(0, 1000).map(buf => {
                    const correlationId = getCorrelationIdFromBuffer(new Uint8Array(buf));
                    if (!correlationId) return null;
                    return correlationId;
                })

                if (!toPush.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;
                }

                pubPaymentRedis.lpush(REDIS_PAYMENTS_QUEUE, ...toPush as string[]);
            }
        })();

        let API_READY = false;

        const redis = await getRedis();

        redis.subscribe('workers:ready', () => {
            console.log("Subscribed to workers:ready");
            API_READY = true;
        });

        while (!API_READY) {
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        Bun.serve({
            routes: {
                '/payments': {
                    POST: async (req) => {
                        const buffer = await req.arrayBuffer();
                        payments.push(buffer);
                        return new Response(null, { status: 201 });
                    }
                },
                '/payments-summary': {
                    GET: async (req) => {
                        const fromIndex = req.url.indexOf('from=') + 5;
                        const toIndex = req.url.indexOf('&to=');
                        const fromDate = req.url.slice(fromIndex, toIndex);
                        const toDate = req.url.slice(toIndex + 4);

                        const from = fromDate || undefined;
                        const to = toDate || undefined;

                        const fromScore = from ? new Date(from).getTime() : undefined;
                        const toScore = to ? new Date(to).getTime() : undefined;

                        const [defaultLength, fallbackLength] = [
                            getLength(processors.default.summary, fromScore, toScore),
                            getLength(processors.fallback.summary, fromScore, toScore)
                        ];

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
                    POST: async (_req) => {
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
    }
})();
