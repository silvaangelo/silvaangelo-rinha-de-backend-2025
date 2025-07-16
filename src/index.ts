import {
    DEFAULT_HEALTH,
    setIntervalDefaultHealth,
    setIntervalDefaultHealthFromRedis,
} from "./processor/default";
import {
    FALLBACK_HEALTH,
    setIntervalFallbackHealth,
    setIntervalFallbackHealthFromRedis,
} from "./processor/fallback";
import { payment } from "./payment";
import {
    getPaymentsSummaryFromRedis,
    getRedis,
    insertPaymentToRedis,
    popPaymentJob,
    pushPaymentJob,
    pushStringPaymentJob,
} from "./redis";

let listening = false;

const startJobListener = async () => {
    if (!listening) {
        listening = true;
        listenToJobs();
        listenToJobs();
        listenToJobs();
    }
};

const listenToJobs = async () => {
    while (true) {
        const job = await popPaymentJob();
        const bothFailing = FALLBACK_HEALTH?.failing && DEFAULT_HEALTH?.failing;
        if (!job) continue;

        if (bothFailing) {
            await pushStringPaymentJob(job.job);

            await new Promise((resolve) => {
                let timeout: any = null;
                let interval: any = null;

                timeout = setTimeout(() => {
                    if (interval) clearInterval(interval);
                    resolve(true);
                }, 50);

                interval = setInterval(() => {
                    const defaultIsActive = DEFAULT_HEALTH &&
                        !DEFAULT_HEALTH.failing;
                    const fallbackIsActive = FALLBACK_HEALTH &&
                        !FALLBACK_HEALTH.failing;

                    if (defaultIsActive || fallbackIsActive) {
                        if (timeout) clearTimeout(timeout);
                        if (interval) clearInterval(interval);
                        resolve(true);
                    }
                }, 1);
            });

            continue;
        }

        const { correlationId, amount } = job;

        try {
            const requestedAt = new Date();
            const result = await payment(correlationId, amount, requestedAt);

            if (result.result) {
                await insertPaymentToRedis(
                    result.processor,
                    requestedAt,
                    correlationId,
                    amount,
                );
            } else {
                await pushStringPaymentJob(job.job);
            }
        } catch (error) {
            console.error("Error processing job:", error);
            await pushStringPaymentJob(job.job);
        }
    }
};

const JSONCONTENT_TYPE = { "Content-Type": "application/json" };

// Helpers
const sendText = (status: number): Response => new Response(null, { status });

const send = (status: number, data: any): Response =>
    new Response(JSON.stringify(data), {
        status: status,
        headers: JSONCONTENT_TYPE,
    });

const server = Bun.serve({
    port: 3000,
    async fetch(req) {
        const { method, url } = req;

        if (method === "POST" && url.includes("/payments")) {
            try {
                const body = await req.json();
                const { correlationId, amount } = body;

                pushPaymentJob(correlationId, amount);
                if (!listening) startJobListener();

                return sendText(202);
            } catch (err) {
                console.error("Error processing payment:", err);
                return sendText(429);
            }
        }

        const parsed = new URL(url);
        const pathname = parsed.pathname;

        if (method === "GET" && pathname === "/payments-summary") {
            const from = parsed.searchParams.get("from");
            const to = parsed.searchParams.get("to");

            const summary = await getPaymentsSummaryFromRedis(
                from ? new Date(from) : undefined,
                to ? new Date(to) : undefined,
            );

            return send(200, summary);
        }

        return send(404, { error: "Not Found" });
    },
});

const start = async () => {
    try {
        console.log("Starting server...");

        await Promise.all([
            getRedis(),
            setIntervalDefaultHealth(),
            setIntervalFallbackHealth(),
            setIntervalDefaultHealthFromRedis(),
            setIntervalFallbackHealthFromRedis(),
        ]);

        console.log("Server is running on port 3000");
    } catch (err) {
        console.error("Error starting server:", err);
        process.exit(1);
    }
};

start();

// Graceful shutdown
process.on("SIGTERM", () => {
    console.log("SIGTERM received, shutting down gracefully...");
    process.exit(0);
});

process.on("SIGINT", () => {
    console.log("SIGINT received, shutting down gracefully...");
    process.exit(0);
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    process.exit(1);
});
