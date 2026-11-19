await prisma.$queryRaw`SELECT * FROM users WHERE id = ${id}`;
await prisma.$queryRawUnsafe('SELECT 1');
