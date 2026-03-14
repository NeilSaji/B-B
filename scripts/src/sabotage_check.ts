import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import keyPairJson from "../keypair.json" with { type: "json" };

const keypair = Ed25519Keypair.fromSecretKey(keyPairJson.privateKey);

const suiClient = new SuiGrpcClient({
  network: 'testnet',
  baseUrl: 'https://fullnode.testnet.sui.io:443',
});

const PLAYERS_TABLE_ID = "0xf3f63bf6a1d4bbf5ba9935eb8eead79d41db29f8c717b8395b74cea8fdb0418c";

function bcsToAddress(bcs: any): string {
  const bytes =
    Array.isArray(bcs) ? bcs : Object.keys(bcs).sort((a, b) => Number(a) - Number(b)).map((k) => bcs[k]);

  return "0x" + bytes.map((x: number) => x.toString(16).padStart(2, "0")).join("");
}

(async () => {
  const owner = keypair.toSuiAddress().toLowerCase();
  console.log("Using address:", owner);
  console.log("Players table id:", PLAYERS_TABLE_ID);

  let cursor: string | undefined = undefined;
  let mine: any = null;
  let page = 1;
  let total = 0;

  while (true) {
    const fields = await suiClient.core.listDynamicFields({
      parentId: PLAYERS_TABLE_ID,
      cursor,
    });

    console.log(`Checking page ${page}...`);
    total += (fields.dynamicFields || []).length;

    for (const f of fields.dynamicFields || []) {
      const addr = bcsToAddress(f.name?.bcs).toLowerCase();
      if (addr === owner) {
        mine = { ...f, decodedAddress: addr };
        break;
      }
    }

    if (mine) break;
    if (!fields.hasNextPage) break;

    cursor = fields.cursor;
    page += 1;
  }

  console.log(`Scanned ${total} player entries.`);

  if (!mine) {
    console.log("Could not find your player entry in the players table.");
    return;
  }

  console.log("Found your player entry:");
  console.log(JSON.stringify(mine, null, 2));

  const obj = await suiClient.core.getObject({
    objectId: mine.fieldId,
    include: { content: true },
  });

  console.log("Your player object:");
  console.log(JSON.stringify(obj, null, 2));
})();
