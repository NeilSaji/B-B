import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = join(__dirname, "../../bot_keypairs");

const NUM_BOTS = parseInt(process.argv[2] || "3");

mkdirSync(BOT_DIR, { recursive: true });

console.log(`Generating ${NUM_BOTS} bot keypairs...`);
console.log(`Saving to: ${BOT_DIR}`);
console.log("");
console.log("Fund these addresses with SUI on testnet before running the bot:");

for (let i = 0; i < NUM_BOTS; i++) {
  const keypair = new Ed25519Keypair();
  const publicAddress = keypair.getPublicKey().toSuiAddress();
  const privateKey = keypair.getSecretKey();

  const data = { publicAddress, privateKey };
  const filename = `bot_${i}.json`;
  writeFileSync(join(BOT_DIR, filename), JSON.stringify(data, null, 2));

  console.log(`  Bot ${i}: ${publicAddress}  →  ${filename}`);
}

console.log("\nNext steps:");
console.log("1. Fund each address with SUI on testnet (use the faucet)");
console.log("2. pnpm tsx src/sabotage_bots.ts register");
console.log("3. pnpm tsx src/sabotage_bots.ts attack");
