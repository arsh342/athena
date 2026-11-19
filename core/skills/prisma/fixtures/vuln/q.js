const t = pickTable();
await prisma.$queryRawUnsafe('SELECT * FROM ' + t); // EXPECT prisma.unsafe-raw-concat
