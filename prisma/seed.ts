import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SeedFriend = { riotName: string; riotTag: string; region?: string };

async function main() {
  const friends: SeedFriend[] = [
    // { riotName: "YourFriend", riotTag: "EUW", region: "euw1" },
  ];

  for (const f of friends) {
    await prisma.friend.create({
      data: {
        riotName: f.riotName,
        riotTag: f.riotTag,
        region: f.region ?? "euw1",
      },
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
