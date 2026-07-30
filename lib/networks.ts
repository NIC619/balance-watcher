export type NetworkPreset = {
  chainId: number;
  name: string;
  symbol: string;
  rpcUrl: string;
  color: string;
  environment: "mainnet" | "testnet";
};

export const NETWORKS: NetworkPreset[] = [
  { chainId: 1, name: "Ethereum", symbol: "ETH", rpcUrl: "https://ethereum-rpc.publicnode.com", color: "#5668db", environment: "mainnet" },
  { chainId: 8453, name: "Base", symbol: "ETH", rpcUrl: "https://mainnet.base.org", color: "#1d5ff2", environment: "mainnet" },
  { chainId: 42161, name: "Arbitrum", symbol: "ETH", rpcUrl: "https://arb1.arbitrum.io/rpc", color: "#2d374b", environment: "mainnet" },
  { chainId: 10, name: "Optimism", symbol: "ETH", rpcUrl: "https://mainnet.optimism.io", color: "#ef3434", environment: "mainnet" },
  { chainId: 137, name: "Polygon", symbol: "POL", rpcUrl: "https://polygon-bor-rpc.publicnode.com", color: "#7b3fe4", environment: "mainnet" },
  { chainId: 560048, name: "Hoodi", symbol: "ETH", rpcUrl: "https://ethereum-hoodi-rpc.publicnode.com", color: "#b86b2d", environment: "testnet" },
  { chainId: 11155111, name: "Sepolia", symbol: "ETH", rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", color: "#9a7426", environment: "testnet" },
];

export function networkById(chainId: number) {
  return NETWORKS.find((network) => network.chainId === chainId);
}
