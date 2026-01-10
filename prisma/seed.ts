import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Example seed data. Edit this list to your friends.
  const friends = [
    // { riotName: "YourFriend", riotTag: "EUW" },
  ];

  for (const f of friends) {
    await prisma.friend.upsert({
      where: { puuid: null as any }, // trick: we don't have unique on riotName+riotTag
      create: { riotName: f.riotName, riotTag: f.riotTag, region: "euw1" },
      update: {},
    }).catch(async () => {
      // Fallback: create if upsert trick fails (keeps seed simple)
      await prisma.friend.create({ data: { riotName: f.riotName, riotTag: f.riotTag, region: "euw1" } });
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
