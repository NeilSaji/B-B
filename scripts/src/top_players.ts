import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

const PLAYERS_TABLE_ID =
  "0xf3f63bf6a1d4bbf5ba9935eb8eead79d41db29f8c717b8395b74cea8fdb0418c";
const rpcClient = new SuiJsonRpcClient({
  url: "https://fullnode.testnet.sui.io:443",
});

(async () => {
  const players: { address: string; shield: number }[] = [];
  let cursor: string | null | undefined = undefined;

  while (true) {
    const page = await rpcClient.getDynamicFields({
      parentId: PLAYERS_TABLE_ID,
      cursor: cursor ?? undefined,
    });

    for (const field of page.data) {
      const obj = await rpcClient.getObject({
        id: field.objectId,
        options: { showContent: true },
      });
      const content = obj.data?.content as any;
      if (content?.dataType === "moveObject") {
        const shield = parseInt(content.fields?.value?.fields?.shield ?? "0");
        const address = content.fields?.name as string;
        players.push({ address, shield });
      }
    }

    if (!page.hasNextPage) break;
    cursor = page.nextCursor;
  }

  players.sort((a, b) => b.shield - a.shield);

  console.log("Rank  Shields  Address");
  console.log("----  -------  -------");
  players.slice(0, 20).forEach((p, i) => {
    console.log(`#${String(i + 1).padEnd(3)} ${String(p.shield).padEnd(8)} ${p.address}`);
  });
  console.log(`\nTotal players: ${players.length}`);
})();
