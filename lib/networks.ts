export type NetworkPreset = {
  chainId: number;
  name: string;
  nativeSymbol: string;
  rpcUrl: string;
  color: string;
  environment: "mainnet" | "testnet";
};

export const NETWORK_PRESETS: NetworkPreset[] = [
  { chainId: 1, name: "Ethereum", nativeSymbol: "ETH", rpcUrl: "https://ethereum-rpc.publicnode.com", color: "#5668db", environment: "mainnet" },
  { chainId: 8453, name: "Base", nativeSymbol: "ETH", rpcUrl: "https://mainnet.base.org", color: "#1d5ff2", environment: "mainnet" },
  { chainId: 42161, name: "Arbitrum", nativeSymbol: "ETH", rpcUrl: "https://arb1.arbitrum.io/rpc", color: "#2d374b", environment: "mainnet" },
  { chainId: 10, name: "Optimism", nativeSymbol: "ETH", rpcUrl: "https://mainnet.optimism.io", color: "#ef3434", environment: "mainnet" },
  { chainId: 137, name: "Polygon", nativeSymbol: "POL", rpcUrl: "https://polygon-bor-rpc.publicnode.com", color: "#7b3fe4", environment: "mainnet" },
  { chainId: 560048, name: "Hoodi", nativeSymbol: "ETH", rpcUrl: "https://ethereum-hoodi-rpc.publicnode.com", color: "#b86b2d", environment: "testnet" },
  { chainId: 11155111, name: "Sepolia", nativeSymbol: "ETH", rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", color: "#9a7426", environment: "testnet" },
];

export function defaultNetworkColor(
  chainId: number,
  environment: "mainnet" | "testnet"
) {
  const hue = environment === "testnet"
    ? 28 + (chainId % 24)
    : (chainId * 47) % 360;
  const saturation = environment === "testnet" ? 52 : 58;
  const lightness = environment === "testnet" ? 42 : 40;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}
