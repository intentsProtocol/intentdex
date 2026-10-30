import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrivyClient } from '@privy-io/node';

dotenv.config();

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Initialize Privy Client
const privy = new PrivyClient({
    appId: process.env.VITE_PRIVY_APP_ID,
    appSecret: process.env.PRIVY_APP_SECRET,
});

console.log("Privy client initialized", Object.keys(privy));

app.post('/api/sign-movement-tx', async (req, res) => {
    try {
        const { walletId, messageHash } = req.body;
        console.log(`Signing request for wallet ${walletId}, hash ${messageHash?.slice(0, 20)}...`);

        if (!walletId || !messageHash) {
            return res.status(400).json({ error: 'Missing walletId or messageHash' });
        }

        // Clean the authorization key (remove 'wallet-auth:' prefix if present)
        const rawKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY || '';
        const authKey = rawKey.replace('wallet-auth:', '');

        // Sign the transaction hash using Privy's wallets.rawSign API
        // Pass authorization key in authorization_context
        const signatureResponse = await privy.wallets().rawSign(walletId, {
            params: {
                hash: messageHash
            },
            authorization_context: {
                authorization_private_keys: [authKey]
            }
        });

        console.log("Privy Response received");

        // Handle response structure
        // rawSign returns { data: { signature: string, encoding: 'hex' }, method: 'raw_sign' }
        let signature;
        if (typeof signatureResponse === 'object' && signatureResponse !== null) {
            signature = signatureResponse.data?.signature || signatureResponse.signature; // Check data.signature first based on d.ts
        } else {
            signature = signatureResponse;
        }

        res.json({ signature });

    } catch (error) {
        console.error('Signing error:', error);
        res.status(500).json({ error: error.message || 'Signing failed' });
    }
});

import { Aptos, AptosConfig, Network, Serializer, Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

const APTOS_NETWORK = Network.CUSTOM;
const config = new AptosConfig({
    network: APTOS_NETWORK,
    fullnode: 'https://testnet.movementnetwork.xyz/v1',
});
const aptos = new Aptos(config);

// Load Admin Key
let adminKey;
try {
    const keyEnv = process.env.ADMIN_PRIVATE_KEY;
    if (keyEnv) {
        adminKey = new Ed25519PrivateKey(keyEnv);
        console.log("Admin private key loaded from environment.");
    } else {
        console.warn("WARNING: ADMIN_PRIVATE_KEY not found in .env. Generating a random key for testing.");
        adminKey = Ed25519PrivateKey.generate();
    }
} catch (e) {
    console.error("Failed to load admin key:", e);
    console.warn("Using random key for server stability.");
    adminKey = Ed25519PrivateKey.generate();
}
console.log("Admin Public Key:", adminKey.publicKey.toString());
const CONTRACT_ADDRESS = process.env.VITE_CONTRACT_ADDRESS || "0xf472a9735febdf619040db29e4f564e77ac5fbc6ea829d7f9cd9563fc8743b8d";

app.post('/api/verify-explore-eligibility', async (req, res) => {
    const { giftCardId, claimerAddress, privyAuthToken } = req.body;

    if (!giftCardId || !claimerAddress || !privyAuthToken) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    try {
        // 1. Verify Privy Token
        // Using correct path for @privy-io/node v0.7.0+: privy.utils().auth().verifyAccessToken()
        // Note: verifyAccessToken verifies the token and returns claims.
        const verifiedClaims = await privy.utils().auth().verifyAccessToken(privyAuthToken);
        console.log("Verified claims:", JSON.stringify(verifiedClaims, null, 2));

        // Try different property names (userId, user_id, sub, id)
        const userId = verifiedClaims.userId || verifiedClaims.user_id || verifiedClaims.sub || verifiedClaims.id;
        console.log("Extracted userId:", userId);

        const user = await privy.users()._get(userId);

        // 2. Fetch Gift Parameters from Chain
        const giftData = await aptos.view({
            payload: {
                function: `${CONTRACT_ADDRESS}::explore_gifts::get_explore_gift`,
                typeArguments: [],
                functionArguments: [giftCardId],
            },
        });

        // Parse requirements
        // Return: [sender, fromName, amount, tokenType, message, themeId, logoUrl, createdAt, expiresAt, claimed, claimedBy, claimedAt, requiredSocials, matchLogic]
        const requiredSocialsBytes = giftData[12]; // vector<u8> (Uint8Array or similar structure from SDK)
        const matchLogic = parseInt(giftData[13]); // 0=AND, 1=OR

        // Convert SDK response to array of numbers if needed
        let requiredSocials = [];
        if (Array.isArray(requiredSocialsBytes)) {
            requiredSocials = requiredSocialsBytes.map(Number);
        } else if (requiredSocialsBytes && typeof requiredSocialsBytes === 'object') {
            // Handle Uint8Array case if SDK returns it differently
            requiredSocials = Array.from(requiredSocialsBytes).map(Number);
        } else if (typeof requiredSocialsBytes === 'string') {
            // Hex string case (0x...)
            const hex = requiredSocialsBytes.replace('0x', '');
            for (let i = 0; i < hex.length; i += 2) {
                requiredSocials.push(parseInt(hex.substr(i, 2), 16));
            }
        }

        console.log(`Checking eligibility for Gift ${giftCardId}: Params [${requiredSocials}] Match [${matchLogic}] User [${userId}]`);
        console.log("User object:", JSON.stringify(user, null, 2));

        // 3. Check Eligibility
        // 1=Email, 2=Twitter, 3=Discord
        // Handle both camelCase and snake_case from SDK
        const accounts = user.linkedAccounts || user.linked_accounts || [];
        const hasEmail = !!accounts.find(a => a.type === 'email');
        const hasTwitter = !!accounts.find(a => a.type === 'twitter_oauth');
        const hasDiscord = !!accounts.find(a => a.type === 'discord_oauth');

        const meetsRequirement = (reqType) => {
            if (reqType === 1) return hasEmail;
            if (reqType === 2) return hasTwitter;
            if (reqType === 3) return hasDiscord;
            return false;
        };

        let eligible = false;
        if (requiredSocials.length === 0) {
            eligible = true;
        } else {
            if (matchLogic === 0) { // AND
                eligible = requiredSocials.every(meetsRequirement);
            } else { // OR
                eligible = requiredSocials.some(meetsRequirement);
            }
        }

        if (!eligible) {
            return res.status(403).json({ error: 'User does not meet social requirements' });
        }

        // 4. Sign Message
        // Message: BCS(gift_id) + BCS(claimer_address)
        const serializer = new Serializer();
        serializer.serializeU64(parseInt(giftCardId));
        const claimerBytes = new Serializer();
        // Address is 32 bytes (hex string)
        const addressBytes = Buffer.from(claimerAddress.replace(/^0x/, ''), 'hex');

        // Combine bytes: U64 (8 bytes) + Address (32 bytes)
        const message = new Uint8Array(8 + 32);
        const idBytes = serializer.toUint8Array();
        message.set(idBytes, 0);
        message.set(addressBytes, 8);

        const signature = adminKey.sign(message);
        // Ed25519Signature.toString() returns hex with 0x prefix
        let signatureHex = signature.toString();
        // Remove 0x prefix if present for consistent frontend parsing
        if (signatureHex.startsWith('0x')) {
            signatureHex = signatureHex.slice(2);
        }
        console.log(`Signature generated. Length: ${signatureHex.length} chars (should be 128 for 64 bytes)`);
        console.log(`Signature hex: ${signatureHex.substring(0, 20)}...`);

        res.json({ signature: signatureHex });

    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

app.listen(port, () => {
    console.log(`Signing server running at http://localhost:${port}`);
});
