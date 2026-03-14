import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import keyPairJson from "../keypair.json" with { type: "json" };

const keypair = Ed25519Keypair.fromSecretKey(keyPairJson.privateKey);

const suiClient = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
});

// CHANGE THIS:
// 1) run once with MODE = "stake"
// 2) wait a little over 1 hour
// 3) change to MODE = "claim" and run again
const MODE: "stake" | "claim" = "stake";

const PACKAGE_ID = "0x936313e502e9cbf6e7a04fe2aeb4c60bc0acd69729acc7a19921b33bebf72d03";
const STAKING_POOL_ID = "0x9cd5b5fe69a62761859536720b9b07c48a1e43b95d8c291855d9fc6779a3b494";
const CLOCK_OBJECT_ID = "0x6";

const NUM_RECEIPTS = 168;
const TOTAL_STAKE = 1_000_000_000n; // 1 SUI in MIST

function buildStakeAmounts(): bigint[] {
  const base = TOTAL_STAKE / BigInt(NUM_RECEIPTS);
  const remainder = TOTAL_STAKE % BigInt(NUM_RECEIPTS);

  const amounts = Array(NUM_RECEIPTS).fill(base) as bigint[];
  amounts[0] = amounts[0] + remainder;
  return amounts;
}

(async () => {
  const owner = keypair.toSuiAddress();
  console.log("Using address:", owner);
  console.log("Mode:", MODE);

  if (MODE === "stake") {
    const amounts = buildStakeAmounts();

    const tx = new Transaction();

    const splitCoins = tx.splitCoins(
      tx.gas,
      amounts.map((amt) => tx.pure.u64(amt))
    );

    const receipts: any[] = [];

    for (let i = 0; i < NUM_RECEIPTS; i++) {
      const receipt = tx.moveCall({
        target: `${PACKAGE_ID}::staking::stake`,
        arguments: [
          tx.object(STAKING_POOL_ID),
          splitCoins[i],
          tx.object(CLOCK_OBJECT_ID),
        ],
      });
      receipts.push(receipt);
    }

    tx.transferObjects(receipts, tx.pure.address(owner));

    console.log(`Staking into ${NUM_RECEIPTS} receipts...`);

    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
    });

    console.log("Stake transaction result:");
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const owned = await suiClient.core.listOwnedObjects({
    owner,
    limit: 500,
  });

  const receiptObjects = (owned.objects || []).filter(
    (obj: any) => obj.type === `${PACKAGE_ID}::staking::StakeReceipt`
  );

  if (receiptObjects.length < NUM_RECEIPTS) {
    throw new Error(
      `Expected at least ${NUM_RECEIPTS} StakeReceipt objects, found ${receiptObjects.length}.`
    );
  }

  console.log(`Found ${receiptObjects.length} receipts`);

  const tx = new Transaction();

  const updatedReceipts = receiptObjects.slice(0, NUM_RECEIPTS).map((obj: any) =>
    tx.moveCall({
      target: `${PACKAGE_ID}::staking::update_receipt`,
      arguments: [
        tx.object(obj.objectId),
        tx.object(CLOCK_OBJECT_ID),
      ],
    })
  );

  let merged = updatedReceipts[0];

  for (let i = 1; i < updatedReceipts.length; i++) {
    merged = tx.moveCall({
      target: `${PACKAGE_ID}::staking::merge_receipts`,
      arguments: [
        merged,
        updatedReceipts[i],
        tx.object(CLOCK_OBJECT_ID),
      ],
    });
  }

  const [flag, returnedCoin] = tx.moveCall({
    target: `${PACKAGE_ID}::staking::claim_flag`,
    arguments: [
      tx.object(STAKING_POOL_ID),
      merged,
      tx.object(CLOCK_OBJECT_ID),
    ],
  });

  tx.transferObjects([flag, returnedCoin], tx.pure.address(owner));

  console.log("Claiming staking flag...");

  const result = await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
  });

  console.log("Claim transaction result:");
  console.log(JSON.stringify(result, null, 2));
})();