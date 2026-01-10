import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SeedFriend = { riotName: string; riotTag: string; region?: string };

async function main() {
  const friends: SeedFriend[] = [
    // { riotName: "YourFriend", riotTag: "EUW", region: "euw1" },
  ];

  if (friends.length === 0) {
    console.log("No seed data provided. Edit prisma/seed.ts to add friends.");
    return;
  }

  await prisma.friend.createMany({
    data: friends.map((f) => ({
      riotName: f.riotName,
      riotTag: f.riotTag,
      region: f.region ?? "euw1",
    })),
  });

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
