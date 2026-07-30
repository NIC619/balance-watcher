export type NetworkPreset = {
  chainId: number;
  name: string;
  symbol: string;
  rpcUrl: string;
  color: string;
};

export const NETWORKS: NetworkPreset[] = [
  { chainId: 1, name: "Ethereum", symbol: "ETH", rpcUrl: "https://eth.llamarpc.com", color: "#5668db" },
  { chainId: 8453, name: "Base", symbol: "ETH", rpcUrl: "https://mainnet.base.org", color: "#1d5ff2" },
  { chainId: 42161, name: "Arbitrum", symbol: "ETH", rpcUrl: "https://arb1.arbitrum.io/rpc", color: "#2d374b" },
  { chainId: 10, name: "Optimism", symbol: "ETH", rpcUrl: "https://mainnet.optimism.io", color: "#ef3434" },
  { chainId: 137, name: "Polygon", symbol: "POL", rpcUrl: "https://polygon-rpc.com", color: "#7b3fe4" },
];

export function networkById(chainId: number) {
  return NETWORKS.find((network) => network.chainId === chainId);
}
