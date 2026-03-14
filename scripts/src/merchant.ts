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
  const PACKAGE_ID = "0x936313e502e9cbf6e7a04fe2aeb4c60bc0acd69729acc7a19921b33bebf72d03";
  const COST_PER_FLAG = 3849000n;

  const owner = keypair.toSuiAddress();
  console.log("Using address:", owner);

  const { balances } = await suiClient.core.listBalances({ owner });
  const usdcBalance = balances.find((b: any) => b.coinType.endsWith("::usdc::USDC"));

  if (!usdcBalance) {
    throw new Error("No USDC balance found. You need testnet USDC first.");
  }

  const USDC_TYPE = usdcBalance.coinType;
  console.log("Detected USDC type:", USDC_TYPE);

  const { objects } = await suiClient.core.listCoins({
    owner,
    coinType: USDC_TYPE,
  });

  const coin = objects.find((c: any) => BigInt(c.balance) >= COST_PER_FLAG);

  if (!coin) {
    throw new Error(`No single USDC coin with at least ${COST_PER_FLAG} balance found.`);
  }

  console.log("Using USDC coin:", coin.objectId, "balance:", coin.balance);

  const tx = new Transaction();

  const [paymentCoin] = tx.splitCoins(
    tx.object(coin.objectId),
    [tx.pure.u64(COST_PER_FLAG)]
  );

  const flag = tx.moveCall({
    target: `${PACKAGE_ID}::merchant::buy_flag`,
    arguments: [paymentCoin],
  });

  tx.transferObjects([flag], tx.pure.address(owner));

  console.log("Sending merchant transaction...");

  const result = await suiClient.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
  });

  console.log("Transaction result:");
  console.log(JSON.stringify(result, null, 2));
})();