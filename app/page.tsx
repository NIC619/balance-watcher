import { Dashboard } from "./dashboard";

export const metadata = {
  title: "Watchtower — EVM Balance Monitor",
  description: "Monitor native balances across EVM networks and get Telegram alerts before funds run low.",
};

export default function Home() {
  return <Dashboard />;
}
