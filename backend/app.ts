import express from "express";
import {createClient} from "redis";
import {json} from "body-parser";

const DEFAULT_BALANCE = 100;
const NUMBER_OF_RETRIES = 5;

interface ChargeResult {
    isAuthorized: boolean;
    remainingBalance: number;
    charges: number;
}

async function connect(): Promise<ReturnType<typeof createClient>> {
    const url = `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`;
    console.log(`Using redis URL ${url}`);
    const client = createClient({url});
    await client.connect();
    return client;
}

async function reset(account: string): Promise<void> {
    const client = await connect();
    try {
        await client.set(`${account}/balance`, DEFAULT_BALANCE);
    } finally {
        await client.disconnect();
    }
}

function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function backoff(retry_number: number): Promise<number> {
    if (retry_number > 1) {
        return await backoff(retry_number - 1) + await backoff(retry_number - 2)
    }
    return 1
}

async function charge(account: string, charges: number): Promise<ChargeResult> {
    const client = await connect();
    let retries = NUMBER_OF_RETRIES;
    try {
        while (retries > 0) {
            try {
                await client.watch(`${account}/balance`);
                const currentBalance = Number(await client.get(`${account}/balance`));
                if (currentBalance > charges) {
                    const multi = client.multi();
                    multi.set(`${account}/balance`, currentBalance - charges);
                    const result = await multi.exec();
                    if (result) {
                        return {isAuthorized: true, remainingBalance: currentBalance - charges, charges: charges}
                    } else {
                        await sleep(await backoff(NUMBER_OF_RETRIES - retries));
                        retries -= 1
                    }
                } else {
                    return {isAuthorized: true, remainingBalance: currentBalance, charges: 0};
                }
            } catch (error) {
                await sleep(await backoff(NUMBER_OF_RETRIES - retries));
                retries -= 1
            }
        }
    } finally {
        await client.unwatch();
        client.disconnect();
    }
    return {isAuthorized: false, remainingBalance: 0, charges: 0};
}

export function buildApp(): express.Application {
    const app = express();
    app.use(json());
    app.post("/reset", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            await reset(account);
            console.log(`Successfully reset account ${account}`);
            res.sendStatus(204);
        } catch (e) {
            console.error("Error while resetting account", e);
            res.status(500).json({error: String(e)});
        }
    });
    app.post("/charge", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            const result = await charge(account, req.body.charges ?? 10);
            console.log(`Successfully charged account ${account}`);
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({error: String(e)});
        }
    });
    return app;
}
