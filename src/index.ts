import { insertPayment } from "./bSearch";
import { buildPaymentProcessor, PaymentProcessor, paymentProcessors } from "./processor";
import {
    getRedis,
    getSummary,
    REDIS_PAYMENTS_QUEUE,
    RedisInstance
} from "./redis";
import { startWorker } from "./worker";

export const JSONCONTENT_TYPE = { "Content-Type": "application/json" };

const sendText = (status: number): Response => new Response(null, { status });

const send = (status: number, data: any): Response =>
    new Response(JSON.stringify(data), {
        status: status,
        headers: JSONCONTENT_TYPE,
    });

function extractCorrelationIdFromBuffer(buf: Uint8Array): string {
    const target = new TextEncoder().encode('"correlationId":"');
    const start = indexOfBytes(buf, target);
    if (start === -1) return '0';

    const from = start + target.length;
    const to = buf.indexOf(0x22, from); // 0x22 = ASCII for `"`

    return new TextDecoder().decode(buf.subarray(from, to));
}

function indexOfBytes(buf: Uint8Array, target: Uint8Array): number {
    outer: for (let i = 0; i <= buf.length - target.length; i++) {
        for (let j = 0; j < target.length; j++) {
            if (buf[i + j] !== target[j]) continue outer;
        }
        return i;
    }
    return -1;
}

const extractCorrelationId = (json: string) => {
    const start = json.indexOf('"correlationId":"');
    if (start === -1) return '0';
    const from = start + 17;
    const to = json.indexOf('"', from);
    return json.slice(from, to);
}

const startApi = async (pubRedis: RedisInstance) => Bun.serve({
    port: 3000,
    async fetch(req) {
        const { method, url } = req;

        if (method === "POST" && url.includes("/payments")) {
            const buf = await req.arrayBuffer();
            const correlationId = extractCorrelationIdFromBuffer(new Uint8Array(buf));
            pubRedis.rPush(REDIS_PAYMENTS_QUEUE, correlationId);

            return sendText(202);
        }

        const parsed = new URL(url);
        const pathname = parsed.pathname;

        if (method === "GET" && pathname === "/payments-summary") {
            const from = parsed.searchParams.get("from");
            const to = parsed.searchParams.get("to");

            const fromScore = from ? new Date(from).getTime() : undefined;
            const toScore = to ? new Date(to).getTime() : undefined

            const summary = getSummary(
                fromScore,
                toScore,
            );

            return send(200, summary);
        }

        if (method === "POST" && pathname === "/admin/purge-payments") {
            paymentProcessors.default.summary = [];
            paymentProcessors.fallback.summary = [];

            return send(200, {
                message: "All payments purged."
            });
        }

        return send(404, { error: "Not Found" });
    }
});

(async () => {
    const pubRedis = await getRedis();

    (async () => {
        const subRedis = await getRedis();
        const processor = await buildPaymentProcessor(pubRedis, subRedis);

        subRedis.subscribe(paymentProcessors.default.paidChannel, requestedAt => insertPayment(Number(requestedAt), paymentProcessors.default.summary));
        subRedis.subscribe(paymentProcessors.fallback.paidChannel, requestedAt => insertPayment(Number(requestedAt), paymentProcessors.fallback.summary));

        for (let i = 0; i <= 10; i++) {
            startWorker(processor, pubRedis);
        }
    })();

    startApi(pubRedis);
})();
