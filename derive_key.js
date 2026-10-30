
import { Ed25519PrivateKey } from "@aptos-labs/ts-sdk";

const privateKeyHex = "0x4db4fccde4d33e00b820d5d02ee57dc9f4dad3886a58b16471efd7a26f4951f8";
const privateKey = new Ed25519PrivateKey(privateKeyHex);
const publicKey = privateKey.publicKey();

console.log("Public Key:", publicKey.toString());
