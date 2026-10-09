import { prisma } from '../src/config/database.js';
import { createApiKey } from '../src/utils/apiKey.js';

const [serviceName, name = serviceName] = process.argv.slice(2);

if (!serviceName || !/^[a-z0-9][a-z0-9-]{1,98}$/.test(serviceName) || !name || name.length > 100) {
  console.error('Usage: npm run api-key:create -- <service-name> [display-name]');
  console.error('Service name must be 2-99 lowercase letters, numbers, or hyphens.');
  process.exitCode = 1;
} else {
  try {
    const { raw, hash } = createApiKey();
    const record = await prisma.apiKey.create({
      data: { name, serviceName, keyHash: hash },
      select: { id: true, serviceName: true },
    });

    console.log(`Created API key for ${record.serviceName} (${record.id}).`);
    console.log('Copy this key now; it cannot be retrieved later:');
    console.log(raw);
  } catch (error) {
    console.error('Could not create API key. The service name may already exist.');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
