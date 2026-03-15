import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { readdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = join(__dirname, "../../bot_keypairs");

const PACKAGE_ID =
  "0xaff30ff9a4b40845d8bdc91522a2b8e8e542ee41c0855f5cb21a652a00c45e96";
const ARENA_ID =
  "0xd7dd51e3c156a0c0152cad6bc94884db5302979e78f04d631a51ab107f9449e6";
const PLAYERS_TABLE_ID =
  "0xf3f63bf6a1d4bbf5ba9935eb8eead79d41db29f8c717b8395b74cea8fdb0418c";
const CLOCK_OBJECT_ID = "0x6";

const ATTACK_INTERVAL_MS = 620_000; // 10 min 20 sec (20s buffer over cooldown)

// Your own address — bots will never attack this
const MY_ADDRESS = (() => {
  try {
    const kp = JSON.parse(readFileSync(join(__dirname, "../keypair.json"), "utf8"));
    return (kp.publicAddress as string).toLowerCase();
  } catch {
    return ""; // keypair.json not found, only bot addresses excluded
  }
})();

// JSON RPC client for reading object state
const rpcClient = new SuiJsonRpcClient({ url: "https://fullnode.testnet.sui.io:443" });

// gRPC client for sending transactions
const grpcClient = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443",
});

function loadBots(): Ed25519Keypair[] {
  let files: string[];
  try {
    files = readdirSync(BOT_DIR)
      .filter((f) => f.endsWith(".json"))
      .sort();
  } catch {
    console.error(`Could not read bot_keypairs/ directory at: ${BOT_DIR}`);
    console.error("Run: pnpm tsx src/generate_bots.ts <count>");
    process.exit(1);
  }

  if (files.length === 0) {
    console.error("No bot keypair files found. Run: pnpm tsx src/generate_bots.ts <count>");
    process.exit(1);
  }

  return files.map((f) => {
    const data = JSON.parse(readFileSync(join(BOT_DIR, f), "utf8"));
    return Ed25519Keypair.fromSecretKey(data.privateKey);
  });
}

interface PlayerInfo {
  address: string;
  shield: number;
}

async function getAllPlayers(): Promise<PlayerInfo[]> {
  const players: PlayerInfo[] = [];
  let cursor: string | null | undefined = null;

  while (true) {
    const page = await rpcClient.getDynamicFields({
      parentId: PLAYERS_TABLE_ID,
      cursor: cursor ?? undefined,
    });

    // Batch fetch all field objects on this page
    for (const field of page.data) {
      try {
        const obj = await rpcClient.getObject({
          id: field.objectId,
          options: { showContent: true },
        });

        // Dynamic field content: Field<address, PlayerState>
        // fields.name = player address, fields.value.fields = PlayerState
        const content = obj.data?.content as any;
        if (content?.dataType === "moveObject") {
          const fields = content?.fields;
          const playerAddr: string = fields?.name;
          const shield = parseInt(fields?.value?.fields?.shield ?? "0");

          if (playerAddr) {
            players.push({ address: playerAddr.toLowerCase(), shield });
          }
        }
      } catch {
        // Skip entries we can't read
      }
    }

    if (!page.hasNextPage) break;
    cursor = page.nextCursor;
  }

  return players;
}

async function findTopShieldPlayer(
  excludeAddresses: Set<string>
): Promise<string | null> {
  const players = await getAllPlayers();
  const eligible = players.filter(
    (p) => p.shield > 0 && !excludeAddresses.has(p.address)
  );

  if (eligible.length === 0) {
    console.log("  No eligible targets (no non-bot players with shields > 0).");
    return null;
  }

  eligible.sort((a, b) => b.shield - a.shield);
  console.log("  Top players by shield count:");
  eligible.slice(0, 5).forEach((p) =>
    console.log(`    ${p.address}: ${p.shield} shields`)
  );

  return eligible[0].address;
}

async function registerBot(keypair: Ed25519Keypair): Promise<boolean> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::sabotage_arena::register`,
    arguments: [tx.object(ARENA_ID), tx.object(CLOCK_OBJECT_ID)],
  });

  try {
    const result = await grpcClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });
    return (result as any)?.Transaction?.status?.success ?? false;
  } catch (e) {
    console.log(`    Error: ${e}`);
    return false;
  }
}

async function attackWith(
  keypair: Ed25519Keypair,
  target: string
): Promise<boolean> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::sabotage_arena::attack`,
    arguments: [
      tx.object(ARENA_ID),
      tx.pure.address(target),
      tx.object(CLOCK_OBJECT_ID),
    ],
  });

  try {
    const result = await grpcClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });
    return (result as any)?.Transaction?.status?.success ?? false;
  } catch (e) {
    console.log(`    Error: ${e}`);
    return false;
  }
}

async function registerAll(bots: Ed25519Keypair[]) {
  console.log(`Registering ${bots.length} bots in the arena...`);
  for (let i = 0; i < bots.length; i++) {
    const addr = bots[i].toSuiAddress();
    console.log(`  Bot ${i} (${addr})...`);
    const ok = await registerBot(bots[i]);
    console.log(ok ? "    Registered!" : "    Failed (may already be registered or no gas)");
  }
}

async function runAttackLoop(bots: Ed25519Keypair[]) {
  const botAddresses = new Set([
    ...bots.map((b) => b.toSuiAddress().toLowerCase()),
    ...(MY_ADDRESS ? [MY_ADDRESS] : []),
  ]);

  console.log(
    `Attack loop started with ${bots.length} bot(s). Interval: ${ATTACK_INTERVAL_MS / 1000 / 60} min`
  );

  while (true) {
    console.log(`\n=== Attack round: ${new Date().toLocaleString()} ===`);

    console.log("  Scanning arena for top shield player...");
    const target = await findTopShieldPlayer(botAddresses);

    if (target) {
      console.log(`  Target: ${target}`);
      for (let i = 0; i < bots.length; i++) {
        const ok = await attackWith(bots[i], target);
        console.log(`  Bot ${i}: ${ok ? "Attack succeeded" : "Attack failed (cooldown or not registered?)"}`);
      }
    }

    console.log(
      `  Sleeping ${(ATTACK_INTERVAL_MS / 1000 / 60).toFixed(1)} minutes...`
    );
    await new Promise((r) => setTimeout(r, ATTACK_INTERVAL_MS));
  }
}

(async () => {
  const mode = process.argv[2];
  const bots = loadBots();

  console.log(`Loaded ${bots.length} bot(s):`);
  bots.forEach((b, i) => console.log(`  Bot ${i}: ${b.toSuiAddress()}`));
  console.log("");

  if (mode === "register") {
    await registerAll(bots);
  } else if (mode === "attack") {
    await runAttackLoop(bots);
  } else {
    console.log("Usage:");
    console.log("  pnpm tsx src/sabotage_bots.ts register   # Register all bots in the arena");
    console.log("  pnpm tsx src/sabotage_bots.ts attack     # Start the attack loop");
  }
})();
