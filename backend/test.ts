import {performance} from "perf_hooks";
import supertest from "supertest";
import {buildApp} from "./app";
import {expect} from 'expect';

const app = supertest(buildApp());


async function basicLatencyTest() {
    await app.post("/reset").expect(204);
    const start = performance.now();
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    await app.post("/charge").expect(200);
    console.log(`Latency: ${performance.now() - start} ms`);
}

async function runParallel(threadNumber: number) {
    await app.post("/reset").expect(204);
    try {
        const urls: string[] = []
        for (let i = 0; i < threadNumber; i++) {
            urls.push('/charge')
        }

        const responses = await Promise.all(urls.map(async url => {
            try {
                const response = await app.post(url);
                return response.text;
            } catch (error) {
                console.error(`Error fetching data from ${url}:`, error);
                return "{}"
            }
        }))

        let lower = 100
        responses.forEach(resp => {
            const entity = JSON.parse(resp.toString());
            if (entity['remainingBalance'] < lower) {
                lower = entity['remainingBalance']
            }
        })
        return lower
    } catch (error) {
        console.error('Error:', error);
    }
    return -1
}

async function parallelBasicChargeTest() {
    const result = await runParallel(3)
    expect(result).toBe(70)
}

async function parallelOverchargeTest() {
    const result = await runParallel(13)
    expect(result).toBe(0)
}


async function runTests() {
   await basicLatencyTest();
   await parallelBasicChargeTest();
   await parallelOverchargeTest();
}

runTests().catch(console.error);
