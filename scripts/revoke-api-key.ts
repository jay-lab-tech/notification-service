import { prisma } from '../src/config/database.js';

const id = process.argv[2];

if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
  console.error('Usage: npm run api-key:revoke -- <api-key-id>');
  process.exitCode = 1;
} else {
  try {
    const result = await prisma.apiKey.updateMany({
      where: { id, isActive: true },
      data: { isActive: false },
    });
    if (result.count === 0) {
      console.error('Active API key not found.');
      process.exitCode = 1;
    } else {
      console.log(`Revoked API key ${id}.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
