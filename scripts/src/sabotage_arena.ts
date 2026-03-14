import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import keyPairJson from "../keypair.json" with { type: "json" };

const keypair = Ed25519Keypair.fromSecretKey(keyPairJson.privateKey);

const suiClient = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
});

const PACKAGE_ID = "0xaff30ff9a4b40845d8bdc91522a2b8e8e542ee41c0855f5cb21a652a00c45e96";
const ARENA_ID = "0xd7dd51e3c156a0c0152cad6bc94884db5302979e78f04d631a51ab107f9449e6";
const CLOCK_OBJECT_ID = "0x6";

// CHANGE THIS:
let MODE: "register" | "build" | "claim" | "autobuild" = "autobuild";

const AUTO_BUILDS = 7;   // change depending on how many successful builds you still need
const SLEEP_MS = 620000;  // 10 min 20 sec

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendRegister() {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::sabotage_arena::register`,
    arguments: [tx.object(ARENA_ID), tx.object(CLOCK_OBJECT_ID)],
  });

  return await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
  });
}

async function sendBuild() {
  const tx = new Transaction();

  tx.moveCall({
    target: `${PACKAGE_ID}::sabotage_arena::build`,
    arguments: [tx.object(ARENA_ID), tx.object(CLOCK_OBJECT_ID)],
  });

  return await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
  });
}

async function sendClaim(owner: string) {
  const tx = new Transaction();

  const flag = tx.moveCall({
    target: `${PACKAGE_ID}::sabotage_arena::claim_flag`,
    arguments: [tx.object(ARENA_ID), tx.object(CLOCK_OBJECT_ID)],
  });

  tx.transferObjects([flag], tx.pure.address(owner));

  return await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
  });
}

async function autoBuild() {
  console.log(`Autobuild starting for ${AUTO_BUILDS} attempts...`);

  let successCount = 0;

  for (let i = 1; i <= AUTO_BUILDS; i++) {
    console.log(`\n=== autobuild attempt ${i}/${AUTO_BUILDS} ===`);
    console.log("Time:", new Date().toLocaleString());

    try {
      const result = await sendBuild();
      console.log(JSON.stringify(result, null, 2));

      const status = (result as any)?.Transaction?.status;
      if (status?.success) {
        successCount += 1;
        console.log(`Build succeeded. Successful autobuilds in this run: ${successCount}`);
      } else {
        console.log("Build did not succeed.");
      }
    } catch (err) {
      console.log("Build failed:");
      console.log(String(err));
    }

    if (i < AUTO_BUILDS) {
      console.log(`Sleeping ${(SLEEP_MS / 1000 / 60).toFixed(2)} minutes...`);
      await sleep(SLEEP_MS);
    }
  }

  console.log(`\nAutobuild finished. Successful builds during this run: ${successCount}`);
  console.log("If you think you're at threshold now, switch MODE to 'claim' and run again.");
}

(async () => {
  const owner = keypair.toSuiAddress();
  console.log("Using address:", owner);
  console.log("Mode:", MODE);

  if (MODE === "register") {
    const result = await sendRegister();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (MODE === "build") {
    const result = await sendBuild();
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (MODE === "claim") {
    const result = await sendClaim(owner);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  await autoBuild();
})();
