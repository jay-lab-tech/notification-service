import { prisma } from '../src/config/database.js';

const serviceName = process.argv[2];

try {
  const keys = await prisma.apiKey.findMany({
    ...(serviceName ? { where: { serviceName } } : {}),
    orderBy: [{ serviceName: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      serviceName: true,
      isActive: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
  console.log(JSON.stringify(keys, null, 2));
} finally {
  await prisma.$disconnect();
}
