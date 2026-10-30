import { Aptos, AptosConfig, Network } from "@aptos-labs/ts-sdk";

// Change this to switch networks
export const CURRENT_NETWORK: 'testnet' | 'mainnet' = 'testnet';

export const MOVEMENT_CONFIGS = {
    mainnet: {
        chainId: 126,
        name: "Movement Mainnet",
        fullnode: "https://full.mainnet.movementinfra.xyz/v1",
        explorer: "mainnet"
    },
    testnet: {
        chainId: 250,
        name: "Movement Testnet",
        fullnode: "https://testnet.movementnetwork.xyz/v1",
        explorer: "testnet"
    }
};

export const CONTRACT_ADDRESS = "0xf472a9735febdf619040db29e4f564e77ac5fbc6ea829d7f9cd9563fc8743b8d"; // Deployed address

const selectedConfig = MOVEMENT_CONFIGS[CURRENT_NETWORK];

const config = new AptosConfig({
    network: Network.CUSTOM,
    fullnode: selectedConfig.fullnode,
});

export const aptos = new Aptos(config);
