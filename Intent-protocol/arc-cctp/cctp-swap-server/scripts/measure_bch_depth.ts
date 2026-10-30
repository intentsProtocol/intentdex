import https from 'node:https';

interface QuoteReq {
    dry: boolean;
    swapType: string;
    originAsset: string;
    destinationAsset: string;
    amount: string;
    recipient: string;
    recipientType: string;
    refundTo: string;
    refundType: string;
    depositType: string;
    slippageTolerance: number;
    deadline: string;
}

interface QuoteRes {
    status: number;
    body?: any;
    raw?: string;
}

function requestQuote(body: QuoteReq): Promise<QuoteRes> {
    const data = JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = https.request('https://1click.chaindefuser.com/v0/quote', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
            },
        }, (res) => {
            let resData = '';
            res.on('data', (c) => { resData += c; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode || 500, body: JSON.parse(resData) });
                } catch {
                    resolve({ status: res.statusCode || 500, raw: resData });
                }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

const BASE_USDC = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const SOL_USDC = 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near';
const ARB_USDC = 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near';
const BCH_ASSET = 'nep141:bch.omft.near';

const EVM_ADDR = '0x2527D02599Ba641c19FEa793cD0F167589a0f10D';
const BCH_ADDR = 'qp3wjpa3tjlj042z2wv7hahsldgwhwy0rq9sywjpyy';
const SOL_ADDR = '7N24yMhC7nJ9qN2w8Qv8V3t8bK9Wj2kL8xY7Z3q1mR5t';

async function testDirection(name: string, fromAsset: string, toAsset: string, refundTo: string, recipient: string, isFromUsdc: boolean) {
    console.log(`\n======================================================`);
    console.log(`Route: ${name}`);
    console.log(`======================================================`);
    const sizes = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
    const bchSpot = 270.46;

    for (const sizeUsd of sizes) {
        let amountStr: string;
        if (isFromUsdc) {
            amountStr = String(Math.round(sizeUsd * 1e6)); // 6 decimals
        } else {
            const bchAmount = sizeUsd / bchSpot;
            amountStr = String(Math.round(bchAmount * 1e8)); // 8 decimals
        }

        const res = await requestQuote({
            dry: true,
            swapType: 'EXACT_INPUT',
            originAsset: fromAsset,
            destinationAsset: toAsset,
            amount: amountStr,
            recipient,
            recipientType: 'DESTINATION_CHAIN',
            refundTo,
            refundType: 'ORIGIN_CHAIN',
            depositType: 'ORIGIN_CHAIN',
            slippageTolerance: 100,
            deadline: new Date(Date.now() + 3600_000).toISOString(),
        });

        if (res.status === 201 && res.body?.quote) {
            const q = res.body.quote;
            const inUsd = Number(q.amountInUsd);
            const outUsd = Number(q.amountOutUsd);
            const slip = ((1 - (outUsd / inUsd)) * 100).toFixed(3);
            const effPrice = isFromUsdc
                ? (inUsd / Number(q.amountOutFormatted)).toFixed(2)
                : (outUsd / Number(q.amountInFormatted)).toFixed(2);

            console.log(
                `$${String(sizeUsd).padStart(5)} | In: ${q.amountInFormatted.padStart(10)} ($${inUsd.toFixed(2)}) | ` +
                `Out: ${q.amountOutFormatted.padStart(10)} ($${outUsd.toFixed(2)}) | ` +
                `Eff $/BCH: ${effPrice} | Cost: ${slip}% | ETA: ${q.timeEstimate}s`
            );
        } else {
            console.log(`$${String(sizeUsd).padStart(5)} | FAILED (${res.status}): ${JSON.stringify(res.body?.message || res.body || res.raw)}`);
        }
    }
}

async function main() {
    await testDirection('Base USDC -> BCH', BASE_USDC, BCH_ASSET, EVM_ADDR, BCH_ADDR, true);
    await testDirection('BCH -> Base USDC', BCH_ASSET, BASE_USDC, BCH_ADDR, EVM_ADDR, false);
    await testDirection('Arbitrum USDC -> BCH', ARB_USDC, BCH_ASSET, EVM_ADDR, BCH_ADDR, true);
    await testDirection('BCH -> Arbitrum USDC', BCH_ASSET, ARB_USDC, BCH_ADDR, EVM_ADDR, false);
}

main().catch(console.error);
